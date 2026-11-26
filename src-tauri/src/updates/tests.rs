//! End-to-end lifecycle tests on an in-memory database with fixture providers
//! (no network). Live source checks are `#[ignore]`d `live_` tests.

use super::*;
use crate::updates::model::Payload;
use crate::updates::providers::BoxFut;

struct Fake {
    id: &'static str,
    datasets: &'static [&'static str],
    data: Arc<Mutex<Result<Vec<Entry>, ProviderError>>>,
}

impl DatasetProvider for Fake {
    fn id(&self) -> &'static str {
        self.id
    }
    fn datasets(&self) -> &'static [&'static str] {
        self.datasets
    }
    fn fetch<'a>(&'a self, dataset_id: &'static str, _etag: Option<String>) -> BoxFut<'a, Result<FetchOutcome, ProviderError>> {
        let r = self.data.lock().unwrap().clone();
        Box::pin(async move {
            let entries = r?;
            let game = if dataset_id.starts_with("poe2") { GameId::Poe2 } else { GameId::Poe1 };
            Ok(FetchOutcome::Data(Payload { dataset_id, game, league: None, entries, source_version: Some("fixture".into()), source_url: "https://repoe-fork.github.io/fixture".into(), etag: None, bytes: 10 }))
        })
    }
}

fn card(i: usize, reward: &str) -> Entry {
    Entry { key: format!("Card {i:03}"), name: format!("Card {i:03}"), data: json!({"stackSize": 5, "reward": reward, "rewardKind": "currencyitem", "dropLevel": 1, "legacy": false}) }
}

fn cards(n: usize) -> Vec<Entry> {
    (0..n).map(|i| card(i, "1x Chaos Orb")).collect()
}

fn league(name: &str) -> Entry {
    Entry { key: name.into(), name: name.into(), data: json!({"hardcore": false, "indexed": true}) }
}

type Slot = Arc<Mutex<Result<Vec<Entry>, ProviderError>>>;

struct Harness {
    svc: Arc<UpdateService>,
    db: Arc<Database>,
    slots: [Slot; 2],
}

impl Harness {
    fn new() -> Self {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let market = MarketEngine::new(Arc::clone(&db));
        let slots: [Slot; 2] = [Arc::new(Mutex::new(Ok(cards(320)))), Arc::new(Mutex::new(Ok(vec![league("Standard"), league("Covens")])))];
        let providers: Vec<Box<dyn DatasetProvider>> = vec![
            Box::new(Fake { id: "repoe-poe1", datasets: &["poe1.divination-cards"], data: Arc::clone(&slots[0]) }),
            Box::new(Fake { id: "poe-ninja", datasets: &["poe1.leagues", "poe2.leagues"], data: Arc::clone(&slots[1]) }),
        ];
        let svc = UpdateService::with_providers(Arc::clone(&db), market, Arc::new(fetch::Fetcher::new()), providers);
        Self { svc, db, slots }
    }
    fn set_cards(&self, r: Result<Vec<Entry>, ProviderError>) {
        self.set(0, r)
    }
    fn set_leagues(&self, r: Result<Vec<Entry>, ProviderError>) {
        self.set(1, r)
    }
    fn set(&self, i: usize, r: Result<Vec<Entry>, ProviderError>) {
        *self.slots[i].lock().unwrap() = r;
    }
    async fn check(&self) -> Report {
        self.svc.run(RunKind::Check, "user", &[Group::GameData, Group::Leagues], None, false).await.unwrap()
    }
    async fn sync(&self) -> Report {
        self.svc.run(RunKind::Sync, "user", &[Group::GameData, Group::Leagues], None, false).await.unwrap()
    }
    fn installed(&self, id: &str) -> Option<(store::VersionInfo, Vec<Entry>)> {
        store::installed_entries(&self.db, id).unwrap()
    }
    fn pending(&self, id: &str) -> Vec<store::ChangeRow> {
        store::changes(&self.db, Some("pending"), Some(id), 10_000).unwrap()
    }
}

const CARDS: &str = "poe1.divination-cards";

#[tokio::test]
async fn check_stages_without_installing_then_apply_installs() {
    let h = Harness::new();
    let r = h.check().await;
    assert_eq!(r.status, "ok");
    assert_eq!(r.staged.len(), 3, "cards + PoE 1 and PoE 2 leagues");
    assert!(h.installed(CARDS).is_none(), "Check for Updates never installs");
    assert_eq!(h.pending(CARDS).len(), 320);
    let v = h.svc.apply(CARDS, None).await.unwrap();
    let (iv, e) = h.installed(CARDS).unwrap();
    assert_eq!((iv.id, e.len(), iv.status.as_str()), (v, 320, "installed"));
    assert!(h.pending(CARDS).is_empty());
    let applied = store::changes(&h.db, Some("applied"), Some(CARDS), 10_000).unwrap();
    assert_eq!(applied.len(), 320);
    let ev = store::events(&h.db, &store::EventFilter::default()).unwrap();
    assert!(ev.iter().any(|e| e.kind == "applied" && e.modules == vec!["deck-intelligence".to_string()]));
}

#[tokio::test]
async fn sync_auto_applies_safe_updates_and_detects_changes() {
    let h = Harness::new();
    let r = h.sync().await;
    assert_eq!(r.applied.len(), 3, "cards + both games' leagues: {r:?}");
    let first = h.installed(CARDS).unwrap().0.id;
    // Unchanged source → nothing staged.
    let r = h.check().await;
    assert!(r.staged.is_empty());
    assert!(r.unchanged.contains(&CARDS.to_string()));
    // One modified, one added, one removed.
    let mut next = cards(320);
    next[0] = card(0, "2x Chaos Orb");
    next.remove(1);
    next.push(card(900, "Headhunter"));
    h.set_cards(Ok(next));
    let r = h.check().await;
    assert_eq!(r.staged.len(), 1);
    let p = h.pending(CARDS);
    let ty = |k: &str| p.iter().find(|c| c.entry_key == k).map(|c| c.change_type.clone());
    assert_eq!(ty("Card 000").as_deref(), Some("description_updated"));
    assert_eq!(ty("Card 001").as_deref(), Some("removed"));
    assert_eq!(ty("Card 900").as_deref(), Some("added"));
    assert_eq!(h.installed(CARDS).unwrap().0.id, first, "still the old version until applied");
    let before = p.iter().find(|c| c.entry_key == "Card 000").unwrap();
    assert_eq!(before.before.as_ref().unwrap()["data"]["reward"], "1x Chaos Orb");
    assert_eq!(before.after.as_ref().unwrap()["data"]["reward"], "2x Chaos Orb");
}

#[tokio::test]
async fn partial_apply_then_rest_and_rollback() {
    let h = Harness::new();
    h.sync().await;
    let v1 = h.installed(CARDS).unwrap().0.id;
    let mut next = cards(320);
    next[0] = card(0, "2x Chaos Orb");
    next.push(card(900, "Headhunter"));
    h.set_cards(Ok(next.clone()));
    h.check().await;
    let added = h.pending(CARDS).into_iter().find(|c| c.change_type == "added").unwrap();
    let v2 = h.svc.apply(CARDS, Some(vec![added.id])).await.unwrap();
    let (iv, e) = h.installed(CARDS).unwrap();
    assert_eq!((iv.id, iv.origin.as_str(), e.len()), (v2, "partial", 321));
    assert_eq!(e.iter().find(|x| x.key == "Card 000").unwrap().data["reward"], "1x Chaos Orb", "unselected change not applied");
    assert_eq!(h.pending(CARDS).len(), 1);
    // Applying the rest installs the full staged version.
    let v3 = h.svc.apply(CARDS, None).await.unwrap();
    assert_eq!(hash_entries(&h.installed(CARDS).unwrap().1), hash_entries(&next));
    // Rollback to v1 restores it; nothing is deleted.
    h.svc.rollback(CARDS, v1).await.unwrap();
    let (iv, e) = h.installed(CARDS).unwrap();
    assert_eq!((iv.id, e.len()), (v1, 320));
    let all = store::versions(&h.db, CARDS, 50).unwrap();
    assert!(all.iter().any(|v| v.id == v3 && v.status == "previous" && v.has_content));
    assert!(store::events(&h.db, &store::EventFilter::default()).unwrap().iter().any(|e| e.kind == "rollback" && e.to_version == Some(v1)));
    assert!(h.svc.rollback(CARDS, v1).await.is_err(), "already installed");
}

#[tokio::test]
async fn failed_validation_and_source_errors_never_touch_installed_data() {
    let h = Harness::new();
    h.sync().await;
    let (v, _) = h.installed(CARDS).unwrap();
    h.set_cards(Ok(cards(12)));
    let r = h.sync().await;
    assert_eq!(r.status, "partial", "leagues still succeed");
    assert_eq!(r.failures[0].operation, "validate");
    assert!(r.failures[0].existing_data_usable);
    assert_eq!(h.installed(CARDS).unwrap().0.id, v.id);
    assert!(store::staged(&h.db, CARDS).unwrap().is_none(), "failed data is not staged");
    h.set_cards(Err(ProviderError::Http(503)));
    h.set_leagues(Err(ProviderError::Timeout));
    let r = h.sync().await;
    assert_eq!(r.status, "failed");
    assert!(r.failures.iter().all(|f| f.retryable));
    assert_eq!(h.installed(CARDS).unwrap().0.id, v.id);
    let s = store::source_state(&h.db, "repoe-poe1").unwrap();
    assert_eq!((s.status.as_str(), s.last_error_kind.as_deref()), ("error", Some("http")));
    h.set_cards(Err(ProviderError::Structure("changed".into())));
    let r = h.sync().await;
    assert!(!r.failures[0].retryable);
}

#[tokio::test]
async fn structural_changes_and_mass_removals_wait_for_review() {
    let h = Harness::new();
    h.sync().await;
    let v = h.installed(CARDS).unwrap().0.id;
    let mut next = cards(320);
    for e in &mut next {
        e.data["artwork"] = json!("x.png");
    }
    h.set_cards(Ok(next));
    let r = h.sync().await;
    assert!(r.applied.iter().all(|a| a["datasetId"] != CARDS), "structural change is not auto-applied");
    assert_eq!(h.installed(CARDS).unwrap().0.id, v);
    let p = h.pending(CARDS);
    assert!(p.iter().all(|c| c.requires_review));
    let structural = p.iter().find(|c| c.change_type == "structural").unwrap();
    let other = p.iter().find(|c| c.change_type != "structural").unwrap();
    assert!(h.svc.apply(CARDS, Some(vec![structural.id])).await.is_err(), "structure can't be applied partially");
    assert!(h.svc.apply(CARDS, Some(vec![other.id])).await.is_ok());
}

#[tokio::test]
async fn mass_removals_wait_for_review() {
    let h = Harness::new();
    h.set_cards(Ok(cards(400)));
    h.sync().await;
    let before = h.installed(CARDS).unwrap().0.id;
    h.set_cards(Ok(cards(300)));
    let r = h.sync().await;
    assert!(r.applied.iter().all(|a| a["datasetId"] != CARDS), "100 of 400 removed must wait for review");
    assert!(r.staged.iter().any(|s| s["datasetId"] == CARDS && s["needsReview"] == true && s["validation"] == "review"), "{r:?}");
    assert_eq!(h.installed(CARDS).unwrap().0.id, before);
}

#[tokio::test]
async fn ignored_changes_stay_ignored_on_recheck() {
    let h = Harness::new();
    h.sync().await;
    let mut next = cards(320);
    next.push(card(900, "Headhunter"));
    h.set_cards(Ok(next));
    h.check().await;
    let c = h.pending(CARDS)[0].clone();
    store::set_change_status(&h.db, &[c.id], Some("ignored"), None, 1).unwrap();
    h.check().await;
    let again = store::changes(&h.db, None, Some(CARDS), 100).unwrap();
    assert_eq!(again[0].status, "ignored", "same change detected again starts ignored");
    assert!(h.pending(CARDS).is_empty());
    // Applying with only an ignored change pending: nothing to apply.
    assert!(h.svc.apply(CARDS, None).await.is_err());
}

#[tokio::test]
async fn league_profiles_keep_ended_leagues() {
    let h = Harness::new();
    h.sync().await;
    h.set_leagues(Ok(vec![league("Standard"), league("Next League")]));
    let r = h.sync().await;
    assert!(r.applied.iter().any(|a| a["datasetId"] == "poe1.leagues"), "{r:?}");
    let p = store::league_profiles(&h.db).unwrap();
    let get = |g: &str, l: &str| p.iter().find(|x| x.game == g && x.league == l).cloned();
    assert_eq!(get("poe1", "Covens").unwrap().status, "ended");
    assert!(get("poe1", "Covens").unwrap().ended_detected_at.is_some());
    assert_eq!(get("poe1", "Next League").unwrap().status, "active");
    assert!(get("poe2", "Covens").is_some(), "each game has its own profiles");
    let ch = store::changes(&h.db, Some("applied"), Some("poe1.leagues"), 100).unwrap();
    assert!(ch.iter().any(|c| c.entry_key == "Covens" && c.change_type == "deprecated"));
}

#[tokio::test]
async fn retention_prunes_old_content_but_keeps_history() {
    let h = Harness::new();
    h.svc.set_settings(Settings { retention: 1, ..Settings::default() }).unwrap();
    h.sync().await;
    for i in 0..4 {
        let mut c = cards(320);
        c[0] = card(0, &format!("{i}x"));
        h.set_cards(Ok(c));
        h.sync().await;
    }
    let vs = store::versions(&h.db, CARDS, 50).unwrap();
    assert_eq!(vs.len(), 5);
    assert_eq!(vs.iter().filter(|v| v.has_content).count(), 2, "installed + 1 kept");
    let oldest = vs.last().unwrap();
    assert!(h.svc.rollback(CARDS, oldest.id).await.is_err(), "pruned version can't be restored");
}

#[tokio::test]
async fn interrupted_runs_are_marked_and_disabled_sources_skipped() {
    let h = Harness::new();
    let id = store::start_check(&h.db, "check", "user", 1).unwrap();
    assert_eq!(store::mark_interrupted(&h.db, 2).unwrap(), 1);
    assert_eq!(store::checks(&h.db, 5).unwrap().iter().find(|c| c.id == id).unwrap().status, "interrupted");
    h.svc.set_source_enabled("repoe-poe1", false).unwrap();
    let r = h.sync().await;
    assert!(h.installed(CARDS).is_none());
    assert!(r.unchanged.iter().any(|u| u.contains("disabled")));
    assert!(h.svc.set_source_enabled("nope", true).is_err());
}

#[tokio::test]
async fn module_access_installs_cards_or_imports_the_legacy_cache() {
    let h = Harness::new();
    let (v, cards_list, err) = h.svc.divination_cards(false, None).await.unwrap();
    assert_eq!((cards_list.len(), err), (320, None));
    assert_eq!(v.origin, "source");
    // Offline first use with a legacy cache → imported.
    let h2 = Harness::new();
    h2.set_cards(Err(ProviderError::Unavailable("offline".into())));
    let legacy = crate::decks::cards::CardDb {
        format: 1,
        cards: (0..400).map(|i| crate::decks::cards::Card { name: format!("C{i}"), stack_size: Some(1), reward: "x".into(), reward_kind: String::new(), drop_level: None, legacy: false }).collect(),
        checked_at: 5,
        source_modified: None,
        etag: None,
    };
    let (v, list, err) = h2.svc.divination_cards(false, Some(legacy)).await.unwrap();
    assert_eq!((v.origin.as_str(), list.len()), ("imported", 400));
    assert!(err.unwrap().contains("unavailable"));
    // Offline with nothing cached → honest error.
    let h3 = Harness::new();
    h3.set_cards(Err(ProviderError::Unavailable("offline".into())));
    assert!(h3.svc.divination_cards(false, None).await.is_err());
}

#[test]
fn schedules_and_settings_validate() {
    assert_eq!(schedule_interval("6h"), Some(6 * 3600));
    assert_eq!(schedule_interval("manual"), None);
    assert_eq!(schedule_interval("0h"), None);
    assert_eq!(schedule_interval("200h"), None);
    let h = Harness::new();
    let mut s = Settings::default();
    s.schedules.leagues = "every minute".into();
    assert!(h.svc.set_settings(s).is_err());
    let s = Settings { retention: 0, ..Settings::default() };
    assert!(h.svc.set_settings(s).is_err());
    assert_eq!(h.svc.settings(), Settings::default());
}

// ---------- live sources (cargo test -- --ignored live_) ----------

#[tokio::test]
#[ignore]
async fn live_repoe_cards_provider() {
    let p = providers::RepoeCards { fetcher: Arc::new(fetch::Fetcher::new()) };
    let FetchOutcome::Data(d) = p.fetch("poe1.divination-cards", None).await.unwrap() else { panic!("expected data") };
    assert!(d.entries.len() > 400, "{}", d.entries.len());
    assert!(d.source_version.is_some(), "RePoE sends Last-Modified");
    let def = registry::dataset("poe1.divination-cards").unwrap();
    assert_eq!(validate::validate(def, &d.entries, 0, None, model::Reliability::Structured).result, Validation::Passed);
    let doctor = d.entries.iter().find(|e| e.key == "The Doctor").unwrap();
    assert_eq!(doctor.data["reward"], "Headhunter");
    let again = p.fetch("poe1.divination-cards", d.etag.clone()).await.unwrap();
    assert!(matches!(again, FetchOutcome::NotModified), "ETag is honoured");
}

#[tokio::test]
#[ignore]
async fn live_ggg_patch_notes_and_news() {
    let f = fetch::Fetcher::new();
    for (game, url) in [(GameId::Poe1, patchnotes::POE1_FORUM), (GameId::Poe2, patchnotes::POE2_FORUM)] {
        let fetch::Fetched::Body(b) = f.get(url, None, "text/html", 4 << 20).await.unwrap() else { panic!() };
        let list = patchnotes::parse_forum_list(&String::from_utf8_lossy(&b.body), game);
        assert!(list.len() >= 5, "{game}: {}", list.len());
        assert!(list.iter().all(|d| d.published_at.is_some()));
        let first = &list[0];
        let fetch::Fetched::Body(t) = f.get(&first.url, None, "text/html", 4 << 20).await.unwrap() else { panic!() };
        let lines = patchnotes::first_post_lines(&String::from_utf8_lossy(&t.body)).expect("first post");
        assert!(!lines.is_empty(), "{}", first.title);
    }
    let fetch::Fetched::Body(b) = f.get(patchnotes::NEWS_RSS, None, "application/rss+xml", 2 << 20).await.unwrap() else { panic!() };
    assert!(patchnotes::parse_rss(&String::from_utf8_lossy(&b.body)).len() >= 5);
}
