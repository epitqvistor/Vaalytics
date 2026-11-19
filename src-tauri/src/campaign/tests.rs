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
fn games_are_isolated_and_poe2_only_features_refuse_poe1() {
    let db = Database::open_in_memory().unwrap();
    let mut hook = CampaignHook::live(GameId::Poe1);
    let mut l = start_run();
    l.push(line("10:01:00", ": Exile_One (Monk) is now level 10"));
    feed(&db, &mut hook, 0, &l);
    let c = db.conn().unwrap();
    assert!(chars(&c).is_empty(), "a PoE 1 hook never writes PoE 2 rows");
    assert_eq!(store::characters(&c, GameId::Poe1).unwrap().len(), 1);
    assert!(super::require_poe2(GameId::Poe1).is_err());
    assert!(super::require_poe1(GameId::Poe2).is_err());
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

// ---------- PoE 1 (Location Atlas): on-demand sync on the same reader, parser and hook ----------
// Line shapes verified on a real PoE 1 Client.txt (3.26–3.30.0c, names replaced).

fn poe1_start() -> Vec<String> {
    vec![
        "2026/11/17 10:00:00 ***** LOG FILE OPENING *****".into(),
        line("10:00:01", "[HTTP2] User agent: PoE release/tags/3.30.0c Windows x64"),
        line("10:00:05", "Async connecting to ams.login.pathofexile.com:20484"),
    ]
}

fn write_log(path: &std::path::Path, lines: &[String], append: bool) {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(append).write(true).truncate(!append).open(path).unwrap();
    for l in lines {
        write!(f, "{l}\r\n").unwrap();
    }
}

fn poe1_sync(db: &Database, path: &std::path::Path) -> super::sync::SyncSummary {
    super::sync::sync_log(db, GameId::Poe1, path, as_utc_fn, u64::MAX).unwrap()
}
fn as_utc_fn(s: crate::session::log_format::LocalStamp) -> Option<i64> {
    Some(as_utc(s))
}

#[test]
fn poe1_sync_attributes_and_resumes_from_its_position() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("Client.txt");
    let mut l = poe1_start();
    l.extend([
        area("10:01:00", "1_1_1", 1),
        line("10:01:30", ": Exile_One (Shadow) is now level 2"),
        area("10:03:00", "1_1_town", 13),
        line("10:03:10", ": Party_Pal has joined the area."),
        line("10:03:20", ": Party_Pal (Witch) is now level 9"),
        area("10:04:00", "1_1_2", 2),
        line("10:05:00", ": You have received a Passive Skill Point."),
        line("10:05:10", ": You have received a Passive Respec Point."),
        line("10:05:20", ": Exile_One has been slain."),
    ]);
    write_log(&log, &l, false);
    let db = Database::open_in_memory().unwrap();
    let s = poe1_sync(&db, &log);
    assert_eq!(s.remaining, 0);
    let c = db.conn().unwrap();
    let ch = store::characters(&c, GameId::Poe1).unwrap();
    assert_eq!(ch.len(), 1, "the party member isn't the player");
    assert_eq!((ch[0].name.as_str(), ch[0].campaign_zones), ("Exile_One", 3));
    let kinds: Vec<_> = store::events(&c, GameId::Poe1, ch[0].id).unwrap().into_iter().map(|e| e.kind).collect();
    assert_eq!(kinds.iter().filter(|k| *k == "passive_points").count(), 1, "respec points are ignored");
    assert!(kinds.contains(&"death".to_string()));
    // Game isolation: nothing for PoE 2.
    assert!(store::characters(&c, GameId::Poe2).unwrap().is_empty());
    assert_eq!(store::status(&c, GameId::Poe1).unwrap().client_tag.as_deref(), Some("3.30.0c"));
    drop(c);

    // Nothing new → nothing stored; appended lines → only those, same character.
    assert_eq!(poe1_sync(&db, &log).events_stored, 0);
    write_log(&log, &[area("10:06:00", "1_1_3", 4)], true);
    let s2 = poe1_sync(&db, &log);
    assert_eq!((s2.lines, s2.events_stored), (1, 1));
    let c = db.conn().unwrap();
    let ev = store::events(&c, GameId::Poe1, store::characters(&c, GameId::Poe1).unwrap()[0].id).unwrap();
    assert_eq!(ev.last().unwrap().area_id.as_deref(), Some("1_1_3"));
}

#[test]
fn poe1_sync_survives_a_replaced_log_without_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("Client.txt");
    let mut l = poe1_start();
    l.extend([line("10:01:30", ": Exile_One (Shadow) is now level 2"), area("10:02:00", "1_1_2", 2)]);
    write_log(&log, &l, false);
    let db = Database::open_in_memory().unwrap();
    poe1_sync(&db, &log);
    let count = || db.conn().unwrap().query_row("SELECT COUNT(*) FROM campaign_events WHERE game = 'poe1'", [], |r| r.get::<_, i64>(0)).unwrap();
    let before = count();
    // The player deleted the log; the game starts a new, shorter one.
    write_log(&log, &[poe1_start()[0].clone(), area("11:00:00", "1_1_3", 4)], false);
    let s = poe1_sync(&db, &log);
    assert!(s.reset);
    assert_eq!(count(), before + 1);
}

#[test]
fn poe1_reader_refuses_poe2_and_poe2_import_refuses_poe1() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("Client.txt");
    write_log(&log, &poe1_start(), false);
    let db = Database::open_in_memory().unwrap();
    assert!(super::sync::sync_log(&db, GameId::Poe2, &log, as_utc_fn, u64::MAX).is_err());
    assert!(import::import_log(&db, GameId::Poe1, &log, as_utc_fn).is_err());
    assert!(crate::session::discover::is_poe1_log(&log));
    assert!(super::set_poe1_log(&db, &log).is_ok());
    let p2 = dir.path().join("poe2.txt");
    write_log(&p2, &start_run(), false);
    assert!(!crate::session::discover::is_poe1_log(&p2));
    assert!(super::set_poe1_log(&db, &p2).is_err());
}

#[test]
#[ignore]
fn live_poe1_sync() {
    let Ok(path) = std::env::var("VAALYTICS_POE1_LOG") else { return };
    let db = Database::open_in_memory().unwrap();
    let t = std::time::Instant::now();
    let s = super::sync::sync_log(&db, GameId::Poe1, std::path::Path::new(&path), crate::session::localtime::local_to_unix, u64::MAX).unwrap();
    println!("{s:?} in {:?}", t.elapsed());
    let c = db.conn().unwrap();
    for ch in store::characters(&c, GameId::Poe1).unwrap() {
        let ev = store::events(&c, GameId::Poe1, ch.id).unwrap();
        let pts: i64 = ev.iter().filter(|e| e.kind == "passive_points").map(|e| e.amount.unwrap_or(0)).sum();
        println!("char #{} {} → {} lvl {} zones {} passive points {}", ch.id, ch.base_class, ch.class, ch.level, ch.campaign_zones, pts);
        if let Ok(dir) = std::env::var("VAALYTICS_CAMPAIGN_DUMP") {
            std::fs::write(format!("{dir}/poe1-char-{}.json", ch.id), serde_json::to_string(&ev).unwrap()).unwrap();
        }
    }
    drop(c); // the in-memory database has one connection
    let t2 = std::time::Instant::now();
    let again = super::sync::sync_log(&db, GameId::Poe1, std::path::Path::new(&path), crate::session::localtime::local_to_unix, u64::MAX).unwrap();
    println!("second sync {again:?} in {:?}", t2.elapsed());
}

/// Act Tracker (PoE 1): the `/passives` output and respec grants are stored for PoE 1 only, attributed like every
/// other event, and never duplicated by a re-read.
#[test]
fn poe1_passives_output_and_respec_points_are_stored() {
    let db = Database::open_in_memory().unwrap();
    let mut l = poe1_start();
    l.extend([
        line("10:02:00", ": Exile_One (Shadow) is now level 2"),
        area("10:03:00", "1_1_town", 1),
        line("10:04:00", ": You have received a Passive Skill Point."),
        line("10:04:00", ": You have received 2 Passive Respec Points."),
        line("10:05:00", ": 3 total Passive Skill Points (2 allocated)"),
        line("10:05:00", ": 0 total Ascendancy Skill Points (0 allocated)"),
        line("10:05:00", ": 2 Passive Skill Points from character level"),
        line("10:05:00", ": 1 Passive Skill Points from quests:"),
        line("10:05:00", ": (1 from The Dweller of the Deep)"),
        line("10:05:00", ": You have received an Atlas Passive Respec Point."),
    ]);
    let mut hook = CampaignHook::live(GameId::Poe1);
    feed(&db, &mut hook, 0, &l);
    // A re-read of the same lines (same offsets) adds nothing.
    let mut again = CampaignHook::live(GameId::Poe1);
    assert_eq!(feed(&db, &mut again, 0, &l), 0);
    let c = db.conn().unwrap();
    let ch = store::characters(&c, GameId::Poe1).unwrap();
    let ev = store::events(&c, GameId::Poe1, ch[0].id).unwrap();
    let passives: Vec<_> = ev.iter().filter(|e| e.kind == "passives").map(|e| (e.amount, e.detail.clone().unwrap_or_default())).collect();
    assert_eq!(
        passives,
        vec![
            (Some(3), "total:2".to_string()),
            (Some(0), "ascendancy:0".to_string()),
            (Some(2), "level".to_string()),
            (Some(1), "quests".to_string()),
            (Some(1), "quest:The Dweller of the Deep".to_string()),
        ]
    );
    let respec: Vec<_> = ev.iter().filter(|e| e.kind == "respec_points").map(|e| e.amount).collect();
    assert_eq!(respec, vec![Some(2)]); // the Atlas line is not a character respec point

    // PoE 2 never stores them (the format was verified for PoE 1 only).
    let mut l2 = start_run();
    l2.extend([line("10:02:00", ": Exile_Two (Monk) is now level 2"), line("10:05:00", ": (1 from Something)"), line("10:05:00", ": You have received a Passive Respec Point.")]);
    drop(c);
    let mut hook2 = CampaignHook::live(GameId::Poe2);
    feed(&db, &mut hook2, 100, &l2);
    let c = db.conn().unwrap();
    let id2 = chars(&c)[0].id;
    assert!(store::events(&c, GameId::Poe2, id2).unwrap().iter().all(|e| e.kind != "passives" && e.kind != "respec_points"));
}

/// Migration 0010 rebuilds `campaign_events` with the same ids, so the change token is unchanged.
#[test]
fn migration_keeps_events_and_their_ids() {
    let db = Database::open_in_memory().unwrap();
    let c = db.conn().unwrap();
    let sql: String = c.query_row("SELECT sql FROM sqlite_master WHERE name = 'campaign_events'", [], |r| r.get(0)).unwrap();
    assert!(sql.contains("'passives'") && sql.contains("'respec_points'") && sql.contains("UNIQUE (game, log_key, log_offset, kind)"));
    let idx: i64 = c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name LIKE 'campaign_events_%'", [], |r| r.get(0)).unwrap();
    assert_eq!(idx, 2);
}
