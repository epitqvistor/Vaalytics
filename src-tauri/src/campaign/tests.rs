//! Campaign Intelligence Rust tests. Log lines use the shapes verified on a
//! real PoE 2 Client.txt (names replaced).

use super::hook::CampaignHook;
use super::{import, store};
use crate::db::Database;
use crate::game::GameId;
use crate::session::localtime::as_utc;
use crate::session::log_format::{parse_line, LineResult};
use rusqlite::Connection;

const KEY: &str = "test-log";

fn line(t: &str, msg: &str) -> String {
    format!("2026/11/17 {t} 1 a [INFO Client 4242] {msg}")
}
fn area(t: &str, id: &str, level: u32) -> String {
    format!("2026/11/17 {t} 1 a [DEBUG Client 4242] Generating level {level} area \"{id}\" with seed 7")
}

/// Feeds lines (offset = index × 1000) through a hook inside one transaction.
fn feed(db: &Database, hook: &mut CampaignHook, start: u64, lines: &[String]) -> usize {
    let mut conn = db.conn().unwrap();
    let tx = conn.transaction().unwrap();
    let mut changed = 0;
    for (i, l) in lines.iter().enumerate() {
        if let LineResult::Event(p) = parse_line(l) {
            if hook.on_event(&tx, &p.event, as_utc(p.at), KEY, (start + i as u64) * 1000).unwrap() {
                changed += 1;
            }
        }
    }
    tx.commit().unwrap();
    changed
}

fn chars(c: &Connection) -> Vec<store::CharacterRow> {
    store::characters(c, GameId::Poe2).unwrap()
}

fn start_run() -> Vec<String> {
    vec![
        "2026/11/17 10:00:00 ***** LOG FILE OPENING *****".into(),
        line("10:00:01", "[HTTP2] User agent: PoE poe2_production/tags/0.5.5g Windows x64"),
        line("10:00:05", "Async connecting to mil.login.pathofexile2.com:21270"),
    ]
}

#[test]
fn identifies_the_character_and_assigns_earlier_events() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe2);
    let mut l = start_run();
    l.extend([
        area("10:01:00", "G1_1", 1),
        line("10:01:01", "[SCENE] Set Source [The Riverbank]"),
        line("10:03:00", ": Exile_One (Mercenary) is now level 2"),
        area("10:05:00", "G1_town", 15),
        line("10:05:01", "[SCENE] Set Source [Clearfell Encampment]"),
    ]);
    feed(&db, &mut hook, 0, &l);
    let c = db.conn().unwrap();
    let ch = chars(&c);
    assert_eq!(ch.len(), 1);
    assert_eq!((ch[0].name.as_str(), ch[0].class.as_str(), ch[0].level, ch[0].campaign_zones), ("Exile_One", "Mercenary", 2, 2));
    let ev = store::events(&c, GameId::Poe2, ch[0].id).unwrap();
    let zones: Vec<_> = ev.iter().filter(|e| e.kind == "zone").map(|e| (e.area_id.clone().unwrap(), e.area_name.clone())).collect();
    assert_eq!(zones, vec![("G1_1".into(), Some("The Riverbank".into())), ("G1_town".into(), Some("Clearfell Encampment".into()))]);
    let st = store::status(&c, GameId::Poe2).unwrap();
    assert_eq!(st.client_tag.as_deref(), Some("0.5.5g"));
    assert_eq!(st.active_character_id, Some(ch[0].id));
    assert_eq!(st.unassigned_events, 0);
}

#[test]
fn party_members_are_never_the_player() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe2);
    let mut l = start_run();
    l.extend([
        area("10:01:00", "G1_2", 2),
        line("10:01:10", ": Friend_A has joined the area."),
        line("10:01:20", ": Friend_A (Witch) is now level 5"), // joined → party
        line("10:01:30", ": Exile_One (Mercenary) is now level 4"),
        line("10:01:40", ": Friend_B (Monk) is now level 9"), // no login in between → party
        line("10:01:50", ": Friend_B has been slain."),
        line("10:01:55", ": Exile_One has been slain."),
    ]);
    feed(&db, &mut hook, 0, &l);
    let c = db.conn().unwrap();
    let ch = chars(&c);
    assert_eq!(ch.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["Exile_One"]);
    let ev = store::events(&c, GameId::Poe2, ch[0].id).unwrap();
    assert_eq!(ev.iter().filter(|e| e.kind == "death").count(), 1);
}

#[test]
fn character_changes_only_after_a_login() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe2);
    let mut l = start_run();
    l.extend([
        area("10:01:00", "G1_1", 1),
        line("10:02:00", ": Exile_One (Mercenary) is now level 2"),
        line("10:10:00", "Async connecting to mil.login.pathofexile2.com:21270"),
        area("10:11:00", "G2_town", 32),
        line("10:12:00", ": Exile_Two (Witch) is now level 30"),
    ]);
    feed(&db, &mut hook, 0, &l);
    let c = db.conn().unwrap();
    let by_name = |n: &str| chars(&c).into_iter().find(|x| x.name == n).unwrap();
    let one = store::events(&c, GameId::Poe2, by_name("Exile_One").id).unwrap();
    let two = store::events(&c, GameId::Poe2, by_name("Exile_Two").id).unwrap();
    assert!(one.iter().any(|e| e.area_id.as_deref() == Some("G1_1")));
    assert!(two.iter().any(|e| e.area_id.as_deref() == Some("G2_town")));
    assert!(!one.iter().any(|e| e.area_id.as_deref() == Some("G2_town")));
}

#[test]
fn passive_points_ascension_and_duplicates() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe2);
    let mut l = start_run();
    l.extend([
        line("10:01:00", ": Exile_One (Monk) is now level 10"),
        area("10:02:00", "G1_11", 10),
        line("10:03:00", ": You have received 2 Passive Skill Points."),
        line("10:03:00", ": You have received 2 Weapon Set Passive Skill Points."),
        area("10:30:00", "G2_13", 22),
        line("10:40:00", ": Exile_One (Invoker) is now level 23"),
    ]);
    feed(&db, &mut hook, 0, &l);
    // The same lines again (a re-read after a crash, or an import) change nothing.
    let mut hook2 = CampaignHook::live(GameId::Poe2);
    assert_eq!(feed(&db, &mut hook2, 0, &l), 0);
    let c = db.conn().unwrap();
    let ch = &chars(&c)[0];
    assert_eq!((ch.class.as_str(), ch.base_class.as_str()), ("Invoker", "Monk"));
    let ev = store::events(&c, GameId::Poe2, ch.id).unwrap();
    let kinds: Vec<_> = ev.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, vec!["level", "zone", "passive_points", "weapon_set_points", "zone", "ascended", "level"]);
    assert_eq!(ev.iter().find(|e| e.kind == "ascended").unwrap().detail.as_deref(), Some("Monk\u{2192}Invoker"));
}

#[test]
fn leaving_the_campaign_is_recorded_once_and_maps_are_not_stored() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe2);
    let mut l = start_run();
    l.extend([
        line("10:01:00", ": Exile_One (Monk) is now level 60"),
        area("10:02:00", "P3_7", 64),
        area("10:03:00", "HideoutShrine", 65),
    ]);
    feed(&db, &mut hook, 0, &l);
    let before = store::status(&db.conn().unwrap(), GameId::Poe2).unwrap().revision;
    assert!(before > 0);
    // Maps store nothing, so the UI's change token doesn't move (no re-read of events).
    let maps = [area("10:04:00", "MapRazedFields", 79), area("10:05:00", "MapVaalFactory", 79)];
    assert_eq!(feed(&db, &mut hook, 100, &maps), 0);
    assert_eq!(store::status(&db.conn().unwrap(), GameId::Poe2).unwrap().revision, before);
    let c = db.conn().unwrap();
    let ev = store::events(&c, GameId::Poe2, chars(&c)[0].id).unwrap();
    let zones: Vec<_> = ev.iter().filter(|e| e.kind == "zone").filter_map(|e| e.area_id.as_deref()).collect();
    assert_eq!(zones, vec!["P3_7", "HideoutShrine"]);
}

#[test]
fn restart_resumes_the_same_segment_and_character() {
    let db = Database::open_in_memory().unwrap();
    let mut l = start_run();
    l.push(line("10:01:00", ": Exile_One (Monk) is now level 10"));
    feed(&db, &mut CampaignHook::live(GameId::Poe2), 0, &l);
    // New hook = app restart; reading continues mid-run.
    feed(&db, &mut CampaignHook::live(GameId::Poe2), 100, &[area("10:05:00", "G1_12", 11)]);
    let c = db.conn().unwrap();
    let ev = store::events(&c, GameId::Poe2, chars(&c)[0].id).unwrap();
    assert!(ev.iter().any(|e| e.area_id.as_deref() == Some("G1_12")));
    assert_eq!(store::status(&c, GameId::Poe2).unwrap().unassigned_events, 0);
}

#[test]
fn events_before_identification_stay_unassigned_until_known() {
    let db = Database::open_in_memory().unwrap();
    let mut l = start_run();
    l.push(area("10:01:00", "G1_1", 1));
    feed(&db, &mut CampaignHook::live(GameId::Poe2), 0, &l);
    let c = db.conn().unwrap();
    assert!(chars(&c).is_empty());
    assert_eq!(store::status(&c, GameId::Poe2).unwrap().unassigned_events, 1);
}

#[test]
fn poe1_is_ignored_and_rejected() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe1);
    let mut l = start_run();
    l.push(line("10:01:00", ": Exile_One (Monk) is now level 10"));
    assert_eq!(feed(&db, &mut hook, 0, &l), 0);
    assert!(super::require_poe2(GameId::Poe1).is_err());
    assert!(chars(&db.conn().unwrap()).is_empty());
}

#[test]
fn marks_are_validated_replaced_and_removed() {
    let db = Database::open_in_memory().unwrap();
    let mut l = start_run();
    l.push(line("10:01:00", ": Exile_One (Monk) is now level 10"));
    feed(&db, &mut CampaignHook::live(GameId::Poe2), 0, &l);
    let c = db.conn().unwrap();
    let id = chars(&c)[0].id;
    store::set_mark(&c, GameId::Poe2, id, "a1.king-in-the-mists", Some("done"), None, 5).unwrap();
    store::set_mark(&c, GameId::Poe2, id, "a1.king-in-the-mists", Some("skipped"), None, 6).unwrap();
    store::set_mark(&c, GameId::Poe2, id, "a2.ancient-vows", Some("done"), Some("30% increased Charm Effect Duration"), 7).unwrap();
    let m = store::marks(&c, GameId::Poe2, id).unwrap();
    assert_eq!(m.len(), 2);
    assert_eq!(m[0].mark, "skipped");
    assert!(store::set_mark(&c, GameId::Poe2, id, "a1.beira", Some("finished"), None, 8).is_err());
    assert!(store::set_mark(&c, GameId::Poe2, id, "bad id; drop", Some("done"), None, 8).is_err());
    assert!(store::set_mark(&c, GameId::Poe1, id, "a1.beira", Some("done"), None, 8).is_err());
    store::set_mark(&c, GameId::Poe2, id, "a1.king-in-the-mists", None, None, 9).unwrap();
    assert_eq!(store::marks(&c, GameId::Poe2, id).unwrap().len(), 1);
    store::delete_character(&c, GameId::Poe2, id).unwrap();
    let left: i64 = c.query_row("SELECT (SELECT COUNT(*) FROM campaign_events) + (SELECT COUNT(*) FROM campaign_marks)", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test]
fn reward_marks_are_separate_from_objective_marks() {
    let db = Database::open_in_memory().unwrap();
    let mut l = start_run();
    l.push(line("10:01:00", ": Exile_One (Monk) is now level 10"));
    feed(&db, &mut CampaignHook::live(GameId::Poe2), 0, &l);
    let c = db.conn().unwrap();
    let id = chars(&c)[0].id;
    store::set_reward_mark(&c, GameId::Poe2, id, "r.a1.king", Some("boss-defeated"), None, 5).unwrap();
    store::set_reward_mark(&c, GameId::Poe2, id, "r.a1.king", Some("item-acquired"), None, 6).unwrap();
    store::set_reward_mark(&c, GameId::Poe2, id, "r.a3.servi", Some("complete"), Some("25% increased Stun Threshold"), 7).unwrap();
    let m = store::reward_marks(&c, GameId::Poe2, id).unwrap();
    assert_eq!(m.iter().map(|x| (x.reward_id.as_str(), x.stage.as_str())).collect::<Vec<_>>(), vec![("r.a1.king", "item-acquired"), ("r.a3.servi", "complete")]);
    assert_eq!(m[1].choice.as_deref(), Some("25% increased Stun Threshold"));
    assert!(store::marks(&c, GameId::Poe2, id).unwrap().is_empty());
    assert!(store::set_reward_mark(&c, GameId::Poe2, id, "r.a1.king", Some("claimed!"), None, 8).is_err());
    store::set_reward_mark(&c, GameId::Poe2, id, "r.a1.king", None, None, 9).unwrap();
    assert_eq!(store::reward_marks(&c, GameId::Poe2, id).unwrap().len(), 1);
    store::delete_character(&c, GameId::Poe2, id).unwrap();
    let left: i64 = c.query_row("SELECT COUNT(*) FROM campaign_reward_marks", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test]
fn import_reads_a_file_once_and_is_idempotent() {
    let dir = std::env::temp_dir().join(format!("vaalytics-campaign-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("Client.txt");
    let mut l = start_run();
    l.extend([
        line("10:01:00", ": Exile_One (Monk) is now level 10"),
        area("10:02:00", "G1_11", 10),
        line("10:03:00", ": You have received 2 Passive Skill Points."),
    ]);
    let mut text = l.join("\r\n");
    text.push_str("\r\n2026/11/17 10:04:00 1 a [DEBUG Client 4242] Generating level 11 area \"G1_12\""); // incomplete last line
    std::fs::write(&path, text).unwrap();
    let db = Database::open_in_memory().unwrap();
    let a = import::import_log(&db, GameId::Poe2, &path, crate::session::localtime::local_to_unix).unwrap();
    let b = import::import_log(&db, GameId::Poe2, &path, crate::session::localtime::local_to_unix).unwrap();
    assert_eq!((a.characters, a.events_stored), (1, 3));
    assert_eq!(b.events_stored, 0);
    let c = db.conn().unwrap();
    let ev = store::events(&c, GameId::Poe2, chars(&c)[0].id).unwrap();
    assert!(!ev.iter().any(|e| e.area_id.as_deref() == Some("G1_12")));
    // Import never touches the live reader's attribution state.
    assert_eq!(store::status(&c, GameId::Poe2).unwrap().active_character_id, None);
    std::fs::remove_dir_all(dir).ok();
}

/// Imports a real log into a throwaway in-memory DB:
/// `VAALYTICS_POE2_LOG=<path> cargo test -- --ignored live_campaign_import --nocapture`.
#[test]
#[ignore]
fn live_campaign_import() {
    let Ok(path) = std::env::var("VAALYTICS_POE2_LOG") else { return };
    let db = Database::open_in_memory().unwrap();
    let t = std::time::Instant::now();
    let s = import::import_log(&db, GameId::Poe2, std::path::Path::new(&path), crate::session::localtime::local_to_unix).unwrap();
    println!("{s:?} in {:?}", t.elapsed());
    let c = db.conn().unwrap();
    for ch in chars(&c) {
        let ev = store::events(&c, GameId::Poe2, ch.id).unwrap();
        let pts = ev.iter().filter(|e| e.kind == "passive_points").count();
        println!("char #{} {} → {} lvl {} zones {} grants {}", ch.id, ch.base_class, ch.class, ch.level, ch.campaign_zones, pts);
        if let Ok(dir) = std::env::var("VAALYTICS_CAMPAIGN_DUMP") {
            // Events only (no names) for checking the TypeScript engine against real data.
            std::fs::write(format!("{dir}/char-{}.json", ch.id), serde_json::to_string(&ev).unwrap()).unwrap();
        }
    }
    println!("status {:?}", store::status(&c, GameId::Poe2).unwrap());
}
