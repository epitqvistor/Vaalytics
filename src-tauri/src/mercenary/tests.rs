use super::*;
use serde_json::json;

const FIXTURE: &str = include_str!("fixtures/fetch-kineticist.json");

fn ids() -> HashSet<String> {
    ["mercenary.skill_16356", "mercenary.support_5293", "mercenary.support_49419", "mercenary.skill_12583", "mercenary.skill_44258"]
        .into_iter()
        .map(String::from)
        .collect()
}

fn query(stats: serde_json::Value) -> serde_json::Value {
    json!({"query": {"status": {"option": "securable"}, "type": {"option": "MiscScionWandAttacks", "discriminator": "mercenary_warrant"},
        "stats": stats, "filters": {"misc_filters": {"filters": {"ilvl": {"min": 83}}}}}, "sort": {"price": "asc"}})
}

#[test]
fn accepts_bound_group_with_and_not_skill_groups() {
    let q = query(json!([
        {"type": "mercenary", "filters": [{"id": "mercenary.skill_16356"}, {"id": "mercenary.support_5293"}, {"id": "mercenary.support_49419"}]},
        {"type": "and", "filters": [{"id": "mercenary.skill_44258"}]},
        {"type": "not", "filters": [{"id": "mercenary.skill_12583"}]}
    ]));
    validate_query(&q, &ids()).unwrap();
}

#[test]
fn rejects_unknown_stats_second_bound_group_and_unbound_supports() {
    let unknown = query(json!([{"type": "mercenary", "filters": [{"id": "mercenary.skill_99999"}]}]));
    assert!(validate_query(&unknown, &ids()).is_err());
    let two = query(json!([
        {"type": "mercenary", "filters": [{"id": "mercenary.skill_16356"}]},
        {"type": "mercenary", "filters": [{"id": "mercenary.skill_12583"}]}
    ]));
    assert!(validate_query(&two, &ids()).unwrap_err().to_string().contains("one bound skill group"));
    let unbound = query(json!([{"type": "and", "filters": [{"id": "mercenary.support_5293"}]}]));
    assert!(validate_query(&unbound, &ids()).unwrap_err().to_string().contains("bound group"));
    let support_first = query(json!([{"type": "mercenary", "filters": [{"id": "mercenary.support_5293"}, {"id": "mercenary.skill_16356"}]}]));
    assert!(validate_query(&support_first, &ids()).is_err());
    let not_merc = query(json!([{"type": "and", "filters": [{"id": "explicit.stat_3299347043"}]}]));
    assert!(validate_query(&not_merc, &ids()).is_err());
}

#[test]
fn rejects_other_query_shapes() {
    let mut q = query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}]));
    q["query"]["filters"]["trade_filters"] = json!({});
    assert!(validate_query(&q, &ids()).is_err());
    let mut q = query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}]));
    q["query"]["type"]["discriminator"] = json!("alt_x");
    assert!(validate_query(&q, &ids()).is_err());
    let mut q = query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}]));
    q["query"]["filters"]["misc_filters"]["filters"]["ilvl"]["min"] = json!(500);
    assert!(validate_query(&q, &ids()).is_err());
    let mut q = query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}]));
    q["sort"] = json!({"price": "desc"});
    assert!(validate_query(&q, &ids()).is_err());
}

#[test]
fn parses_real_listing_fixture_without_accounts() {
    let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    let raw = v["result"].as_array().unwrap();
    let l = parse_listing(&raw[0], |cur, a| (cur == "chaos").then_some(a)).unwrap();
    assert_eq!(l.amount, Some(100.0));
    assert_eq!(l.currency.as_deref(), Some("chaos"));
    assert_eq!(l.amount_chaos, Some(100.0));
    assert_eq!(l.build.as_deref(), Some("Kineticist"));
    assert_eq!(l.level, Some(83));
    assert!(l.instant_buyout);
    assert_eq!(l.skills.len(), 6);
    let kboc = l.skills.iter().find(|s| s.name == "Kinetic Blast of Clustering").unwrap();
    assert_eq!(kboc.stat, "mercenary.skill_16356");
    assert!(kboc.supports.iter().any(|s| s.stat == "mercenary.support_5293" && s.tier == 3 && s.name == "Return"));
    // Supports stay with their own skill.
    let bolt = l.skills.iter().find(|s| s.name == "Kinetic Bolt").unwrap();
    assert!(!bolt.supports.iter().any(|s| s.name == "Return"));
    let json = serde_json::to_string(&l).unwrap();
    assert!(!json.contains("sample_seller"), "account names must not be kept");
}

#[test]
fn skips_malformed_listings() {
    let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    let mut bad = v["result"][0].clone();
    bad["item"]["mercenarySkills"][0]["supports"][0]["tier"] = json!(7);
    assert!(parse_listing(&bad, |_, _| None).is_none());
    let mut other = v["result"][0].clone();
    other["item"]["baseType"] = json!("Divine Orb");
    assert!(parse_listing(&other, |_, _| None).is_none());
    let mut no_price = v["result"][0].clone();
    no_price["listing"]["price"] = serde_json::Value::Null;
    let l = parse_listing(&no_price, |_, _| None).unwrap();
    assert!(l.amount.is_none() && l.amount_chaos.is_none());
}

#[test]
fn query_hash_depends_on_league_and_query() {
    let q = query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}]));
    assert_eq!(query_hash("Covens", &q), query_hash("Covens", &q.clone()));
    assert_ne!(query_hash("Covens", &q), query_hash("Hardcore Covens", &q));
}

fn req(level: u8) -> SearchRequest {
    SearchRequest {
        query: query(json!([{"type": "and", "filters": [{"id": "mercenary.skill_16356"}]}])),
        level,
        label: "Family baseline".into(),
        count: 10,
        game_version: "3.30.0".into(),
        catalog_version: "3.30.0-r1".into(),
        force: false,
    }
}

#[test]
fn snapshots_are_kept_per_league_and_failed_refresh_keeps_last_good_one() {
    let db = crate::db::Database::open_in_memory().unwrap();
    let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    let listings: Vec<MercListing> = v["result"].as_array().unwrap().iter().filter_map(|r| parse_listing(r, |_, a| Some(a))).collect();
    let r = req(4);
    let mut o = SearchOutcome::failed("Covens", "h1", &r, String::new(), 1000);
    o.status = "ok";
    o.error = None;
    o.listings = listings;
    o.total = Some(309);
    store::save_snapshot(&db, &r, &o).unwrap();
    store::save_failed_snapshot(&db, "Covens", &r, "h1", "Trade could not be reached", 2000).unwrap();

    let last = store::latest_ok_snapshot(&db, "Covens", "h1").unwrap().unwrap();
    assert_eq!(last.fetched_at, 1000);
    assert_eq!(last.listings.len(), 2);
    assert_eq!(last.total, Some(309));
    assert!(store::latest_ok_snapshot(&db, "Hardcore Covens", "h1").unwrap().is_none(), "leagues never mix");
    let all = store::snapshots(&db, "Covens", 10).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].status, "error");
}

#[test]
fn rule_candidates_stay_reviewed_when_evidence_refreshes() {
    let db = crate::db::Database::open_in_memory().unwrap();
    let c = RuleCandidate {
        game_version: "3.30.0".into(),
        catalog_version: "3.30.0-r1".into(),
        rule_key: "kineticist:skill:kinetic_bolt".into(),
        family: "kineticist".into(),
        title: "Kinetic Bolt beside KBoC".into(),
        evidence: json!({"with": 5, "without": 9}),
        with_count: 5,
        without_count: 9,
    };
    let id = store::stage_candidate(&db, "Covens", &c, 1).unwrap();
    store::review_candidate(&db, id, "promoted", 2).unwrap();
    let again = store::stage_candidate(&db, "Covens", &RuleCandidate { with_count: 20, ..c }, 3).unwrap();
    assert_eq!(id, again);
    let rows = store::candidates(&db, "Covens").unwrap();
    assert_eq!(rows[0].status, "promoted");
    assert_eq!(rows[0].candidate.with_count, 20);
    assert!(store::review_candidate(&db, id, "activated", 4).is_err());
}

#[test]
fn valuations_round_trip_per_league() {
    let db = crate::db::Database::open_in_memory().unwrap();
    let rec = ValuationRecord {
        game_version: "3.30.0".into(),
        catalog_version: "3.30.0-r1".into(),
        rules_version: "3.30-r1".into(),
        fingerprint: "kineticist|kinetic_blast_of_clustering[return:3]".into(),
        family: "kineticist".into(),
        title: "Kineticist".into(),
        category: "insufficient".into(),
        confidence: "insufficient".into(),
        level: None,
        count: 0,
        p25_chaos: None,
        median_chaos: None,
        p75_chaos: None,
        divine_rate: Some(140.0),
        summary: json!({}),
    };
    store::save_valuation(&db, "Covens", &rec, 10).unwrap();
    assert_eq!(store::valuations(&db, "Covens", Some(&rec.fingerprint), 10).unwrap().len(), 1);
    assert!(store::valuations(&db, "Standard", None, 10).unwrap().is_empty());
}

/// Live check of the endpoints Mercenary Intelligence relies on (network, opt-in):
///   set VAALYTICS_TRADE_CONTACT=you@example.com
///   cargo test live_mercenary -- --ignored --nocapture
/// Verifies the stat ids used in the fixtures exist, a bound search on Covens returns listings
/// with `mercenarySkills`, and a second bound group is refused for anonymous searches.
#[tokio::test]
#[ignore]
async fn live_mercenary_search_and_limits() {
    let Ok(contact) = std::env::var("VAALYTICS_TRADE_CONTACT") else {
        eprintln!("VAALYTICS_TRADE_CONTACT not set; skipping");
        return;
    };
    let contact = crate::trade::validate_contact(&contact).expect("valid contact");
    let ua = format!("Vaalytics/{} (Windows desktop companion; contact: {contact})", env!("CARGO_PKG_VERSION"));
    let http = reqwest::Client::new();
    let stats: serde_json::Value = http.get("https://www.pathofexile.com/api/trade/data/stats").header("User-Agent", &ua).send().await.unwrap().json().await.unwrap();
    let live: HashSet<String> = stats["result"].as_array().unwrap().iter().flat_map(|g| g["entries"].as_array().unwrap().iter()).filter_map(|e| e["id"].as_str()).filter(|i| i.starts_with("mercenary.")).map(String::from).collect();
    println!("{} mercenary stats", live.len());
    for id in ids() {
        assert!(live.contains(&id), "{id} missing from the live stat list");
    }
    let q = query(json!([{"type": "mercenary", "filters": [{"id": "mercenary.skill_16356"}, {"id": "mercenary.support_5293"}]}]));
    validate_query(&q, &live).unwrap();
    let url = "https://www.pathofexile.com/api/trade/search/Covens";
    let r: serde_json::Value = http.post(url).header("User-Agent", &ua).json(&q).send().await.unwrap().json().await.unwrap();
    println!("bound search total={} complexity={}", r["total"], r["complexity"]);
    let ids: Vec<&str> = r["result"].as_array().unwrap().iter().take(2).filter_map(|x| x.as_str()).collect();
    assert!(!ids.is_empty());
    tokio::time::sleep(Duration::from_secs(2)).await;
    let f: serde_json::Value = http
        .get(format!("https://www.pathofexile.com/api/trade/fetch/{}?query={}", ids.join(","), r["id"].as_str().unwrap()))
        .header("User-Agent", &ua)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let l = parse_listing(&f["result"][0], |_, _| None).expect("listing parses");
    assert!(l.skills.iter().any(|s| s.stat == "mercenary.skill_16356" && s.supports.iter().any(|p| p.stat == "mercenary.support_5293")));
    tokio::time::sleep(Duration::from_secs(8)).await;
    let two = query(json!([
        {"type": "mercenary", "filters": [{"id": "mercenary.skill_16356"}]},
        {"type": "mercenary", "filters": [{"id": "mercenary.skill_12583"}]}
    ]));
    let resp = http.post(url).header("User-Agent", &ua).json(&two).send().await.unwrap();
    let status = resp.status();
    let body = resp.text().await.unwrap();
    println!("two bound groups: {status} {body}");
    assert_eq!(status.as_u16(), 400, "a second bound group is expected to be refused anonymously");
}
