//! JSON and CSV export of recorded sessions.

use super::store::{SessionDetail, SessionSummary};
use crate::game::GameId;
use serde_json::json;

pub fn to_json(game: GameId, details: &[SessionDetail], now: i64) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&json!({
        "app": "Vaalytics",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "kind": "session-intelligence",
        "game": game.as_str(),
        "exportedAt": now,
        "notes": "Times are Unix seconds (UTC). Map completion is not recorded: Client.txt has no reliable completion line.",
        "sessions": details,
    }))
}

fn cell(s: &str) -> String {
    // Neutralise spreadsheet formulas and quote when needed.
    let s = if s.starts_with(['=', '+', '-', '@']) { format!("'{s}") } else { s.to_string() };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

const HEADER: &[&str] = &[
    "id", "started_at_utc", "ended_at_utc", "duration_secs", "status", "end_reason", "log_tracked", "maps_entered", "areas_entered",
    "map_secs", "hideout_secs", "town_secs", "campaign_secs", "content_secs", "unknown_secs", "loading_secs", "afk_secs", "deaths", "level_ups",
];

/// RFC 3339 UTC without external crates.
pub fn iso(t: i64) -> String {
    let days = t.div_euclid(86_400);
    let secs = t.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, secs % 3600 / 60, secs % 60)
}

pub fn to_csv(sessions: &[SessionSummary]) -> String {
    let mut out = HEADER.join(",");
    out.push_str("\r\n");
    for s in sessions {
        let row = [
            s.id.to_string(),
            iso(s.started_at),
            s.ended_at.map(iso).unwrap_or_default(),
            s.duration_secs.to_string(),
            cell(&s.status),
            cell(s.end_reason.as_deref().unwrap_or("")),
            (s.log_tracked as u8).to_string(),
            s.maps_entered.to_string(),
            s.areas_entered.to_string(),
            s.map_secs.to_string(),
            s.hideout_secs.to_string(),
            s.town_secs.to_string(),
            s.campaign_secs.to_string(),
            s.content_secs.to_string(),
            s.unknown_secs.to_string(),
            s.loading_secs.to_string(),
            s.afk_secs.to_string(),
            s.deaths.to_string(),
            s.level_ups.to_string(),
        ];
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::session::store;

    #[test]
    fn exports_csv_and_json() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let id = store::create_session(&c, GameId::Poe2, 1_794_924_465, Some(1), Some(1), true, 0).unwrap();
        store::enter_area(&c, GameId::Poe2, id, &store::NewVisit { area_id: "MapA", area_level: 70, seed: 3, kind: "map", at: 1_794_924_470, log_key: "k", log_offset: 0 }).unwrap();
        store::finish(&c, id, 1_794_928_065, "game_closed").unwrap();
        let s = store::list(&c, GameId::Poe2, &Default::default()).unwrap();
        let csv = to_csv(&s);
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(lines[0].split(',').count(), HEADER.len());
        assert!(lines[1].starts_with(&format!("{id},2026-11-17T14:07:45Z,2026-11-17T15:07:45Z,3600,completed,game_closed,1,1,1")));
        let d = store::detail(&c, GameId::Poe2, id).unwrap().unwrap();
        let json: serde_json::Value = serde_json::from_str(&to_json(GameId::Poe2, &[d], 5).unwrap()).unwrap();
        assert_eq!(json["game"], "poe2");
        assert_eq!(json["sessions"][0]["summary"]["mapsEntered"], 1);
        assert_eq!(json["sessions"][0]["mapRuns"][0]["completed"], serde_json::Value::Null);
    }

    #[test]
    fn csv_cells_are_escaped() {
        assert_eq!(cell("a,b"), "\"a,b\"");
        assert_eq!(cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(cell("=SUM(A1)"), "'=SUM(A1)");
    }
}
