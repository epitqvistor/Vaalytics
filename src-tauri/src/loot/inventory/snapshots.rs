//! Inventory snapshots (tables from 0012_loot_inventory.sql) and the change between two of them.
//!
//! BASELINE → SNAPSHOT → CHANGE. A change is NOT presented as map loot: stash transfers, spending,
//! trades and stack splits change the inventory too. Each line is "estimated" (calculated from two
//! checked snapshots), "needs review" (a low-confidence or unread cell is involved) or "confirmed"
//! (both snapshots were confirmed by the user and nothing in the line is uncertain).

use super::grid::Grid;
use super::recognize::{CellResult, RECOGNIZER_VERSION};
#[cfg(test)]
use super::recognize::Confidence;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub struct NewSnapshot<'a> {
    pub taken_at: i64,
    pub source: &'a str,
    pub session_id: Option<i64>,
    pub map_run_id: Option<i64>,
    pub screen_w: usize,
    pub screen_h: usize,
    pub grid: &'a Grid,
    pub image_file: Option<String>,
    pub league: Option<String>,
    pub cells: &'a [CellResult],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: i64,
    pub taken_at: i64,
    pub source: String,
    pub status: String,
    pub is_baseline: bool,
    pub session_id: Option<i64>,
    pub map_run_id: Option<i64>,
    pub map_assignment: Option<String>,
    pub screen_w: i64,
    pub screen_h: i64,
    pub league: Option<String>,
    pub note: Option<String>,
    pub confirmed_at: Option<i64>,
    pub recognizer_version: i64,
    #[serde(skip)]
    pub image_file: Option<String>,
    /// Occupied cells / cells needing a look (low or unknown, not corrected, not excluded).
    pub cells: i64,
    pub to_review: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub col: i64,
    pub row: i64,
    pub recognized_name: Option<String>,
    pub recognized_category: Option<String>,
    pub icon_score: f64,
    pub tier_strokes: i64,
    pub recognized_quantity: Option<i64>,
    pub quantity_confidence: f64,
    pub confidence: String,
    pub alternatives: Vec<String>,
    pub name: Option<String>,
    pub quantity: Option<i64>,
    pub excluded: bool,
    pub corrected: bool,
}

impl Entry {
    /// Still uncertain: low / unknown recognition the user hasn't corrected, or no name / quantity.
    pub fn uncertain(&self) -> bool {
        !self.excluded && ((!self.corrected && matches!(self.confidence.as_str(), "low" | "unknown")) || self.name.is_none() || self.quantity.is_none())
    }
}

const SNAP_COLS: &str = "s.id, s.taken_at, s.source, s.status, s.is_baseline, s.session_id, s.map_run_id, s.map_assignment, s.screen_w, s.screen_h,
    s.league, s.note, s.confirmed_at, s.recognizer_version, s.image_file,
    (SELECT COUNT(*) FROM loot_inventory_entries e WHERE e.snapshot_id = s.id),
    (SELECT COUNT(*) FROM loot_inventory_entries e WHERE e.snapshot_id = s.id AND e.excluded = 0
       AND ((e.corrected = 0 AND e.confidence IN ('low', 'unknown')) OR e.name IS NULL OR e.quantity IS NULL))";

fn snap_row(r: &Row<'_>) -> rusqlite::Result<Snapshot> {
    Ok(Snapshot {
        id: r.get(0)?,
        taken_at: r.get(1)?,
        source: r.get(2)?,
        status: r.get(3)?,
        is_baseline: r.get::<_, i64>(4)? == 1,
        session_id: r.get(5)?,
        map_run_id: r.get(6)?,
        map_assignment: r.get(7)?,
        screen_w: r.get(8)?,
        screen_h: r.get(9)?,
        league: r.get(10)?,
        note: r.get(11)?,
        confirmed_at: r.get(12)?,
        recognizer_version: r.get(13)?,
        image_file: r.get(14)?,
        cells: r.get(15)?,
        to_review: r.get(16)?,
    })
}

const ENTRY_COLS: &str = "id, col, row, recognized_name, recognized_category, icon_score, tier_strokes, recognized_quantity, quantity_confidence,
    confidence, alternatives, name, quantity, excluded, corrected";

fn entry_row(r: &Row<'_>) -> rusqlite::Result<Entry> {
    let alts: String = r.get(10)?;
    Ok(Entry {
        id: r.get(0)?,
        col: r.get(1)?,
        row: r.get(2)?,
        recognized_name: r.get(3)?,
        recognized_category: r.get(4)?,
        icon_score: r.get(5)?,
        tier_strokes: r.get(6)?,
        recognized_quantity: r.get(7)?,
        quantity_confidence: r.get(8)?,
        confidence: r.get(9)?,
        alternatives: serde_json::from_str(&alts).unwrap_or_default(),
        name: r.get(11)?,
        quantity: r.get(12)?,
        excluded: r.get::<_, i64>(13)? == 1,
        corrected: r.get::<_, i64>(14)? == 1,
    })
}

fn insert_entries(conn: &Connection, game: GameId, id: i64, cells: &[CellResult]) -> AppResult<()> {
    let mut ins = conn.prepare(
        "INSERT INTO loot_inventory_entries (snapshot_id, game, col, row, recognized_name, recognized_category, icon_score, tier_strokes,
            recognized_quantity, quantity_confidence, confidence, alternatives, name, quantity)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?5, ?9)",
    )?;
    for c in cells {
        ins.execute(params![
            id,
            game.as_str(),
            c.col as i64,
            c.row as i64,
            c.name,
            c.category,
            c.icon_score as f64,
            c.tier_strokes as i64,
            c.quantity.map(|q| q as i64),
            c.quantity_confidence as f64,
            c.confidence.as_str(),
            serde_json::to_string(&c.alternatives)?,
        ])?;
    }
    Ok(())
}

/// Stores a recognised screenshot, waiting for the user's review. Returns the snapshot id.
pub fn insert(conn: &Connection, game: GameId, s: &NewSnapshot<'_>) -> AppResult<i64> {
    let grid = serde_json::json!({ "left": s.grid.left, "top": s.grid.top, "cell": s.grid.cell, "score": s.grid.score });
    conn.execute(
        "INSERT INTO loot_inventory_snapshots (game, taken_at, source, status, session_id, map_run_id, map_assignment, screen_w, screen_h, grid,
            image_file, recognizer_version, league)
         VALUES (?1, ?2, ?3, 'review', ?4, ?5, CASE WHEN ?5 IS NULL THEN NULL ELSE 'auto' END, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            game.as_str(),
            s.taken_at,
            s.source,
            s.session_id,
            s.map_run_id,
            s.screen_w as i64,
            s.screen_h as i64,
            grid.to_string(),
            s.image_file,
            RECOGNIZER_VERSION,
            s.league
        ],
    )?;
    let id = conn.last_insert_rowid();
    insert_entries(conn, game, id, s.cells)?;
    Ok(id)
}

/// Re-recognition of the stored screenshot: recognised values are replaced, the user's corrections and
/// exclusions are kept for cells that are still occupied.
pub fn replace_recognition(conn: &Connection, game: GameId, id: i64, cells: &[CellResult]) -> AppResult<()> {
    let old = entries(conn, game, id)?;
    conn.execute("DELETE FROM loot_inventory_entries WHERE snapshot_id = ?1 AND game = ?2", params![id, game.as_str()])?;
    insert_entries(conn, game, id, cells)?;
    for o in old.into_iter().filter(|o| o.corrected || o.excluded) {
        conn.execute(
            "UPDATE loot_inventory_entries SET name = CASE WHEN ?4 = 1 THEN ?5 ELSE name END, quantity = CASE WHEN ?4 = 1 THEN ?6 ELSE quantity END,
                corrected = ?4, excluded = ?7 WHERE snapshot_id = ?1 AND col = ?2 AND row = ?3",
            params![id, o.col, o.row, o.corrected as i64, o.name, o.quantity, o.excluded as i64],
        )?;
    }
    conn.execute("UPDATE loot_inventory_snapshots SET recognizer_version = ?2 WHERE id = ?1", params![id, RECOGNIZER_VERSION])?;
    Ok(())
}

pub fn list(conn: &Connection, game: GameId, limit: i64) -> AppResult<Vec<Snapshot>> {
    let mut stmt = conn.prepare(&format!("SELECT {SNAP_COLS} FROM loot_inventory_snapshots s WHERE s.game = ?1 ORDER BY s.taken_at DESC, s.id DESC LIMIT ?2"))?;
    let rows = stmt.query_map(params![game.as_str(), limit.clamp(1, 2000)], snap_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<Snapshot>> {
    Ok(conn.query_row(&format!("SELECT {SNAP_COLS} FROM loot_inventory_snapshots s WHERE s.game = ?1 AND s.id = ?2"), params![game.as_str(), id], snap_row).optional()?)
}

pub fn entries(conn: &Connection, game: GameId, id: i64) -> AppResult<Vec<Entry>> {
    let mut stmt = conn.prepare(&format!("SELECT {ENTRY_COLS} FROM loot_inventory_entries WHERE game = ?1 AND snapshot_id = ?2 ORDER BY row, col"))?;
    let rows = stmt.query_map(params![game.as_str(), id], entry_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryEdit {
    /// Some("") clears the name (not recognised).
    pub name: Option<String>,
    /// Some(0) clears the quantity.
    pub quantity: Option<i64>,
    pub excluded: Option<bool>,
    /// Back to what was recognised.
    pub reset: Option<bool>,
}

pub fn edit_entry(conn: &Connection, game: GameId, entry_id: i64, e: &EntryEdit) -> AppResult<()> {
    if let Some(n) = &e.name {
        if n.chars().count() > 120 {
            return Err(AppError::InvalidInput("Item names are at most 120 characters.".into()));
        }
    }
    if let Some(q) = e.quantity {
        if !(0..=1_000_000).contains(&q) {
            return Err(AppError::InvalidInput("Quantity must be between 1 and 1,000,000.".into()));
        }
    }
    let n = if e.reset == Some(true) {
        conn.execute(
            "UPDATE loot_inventory_entries SET name = recognized_name, quantity = recognized_quantity, corrected = 0, excluded = 0 WHERE id = ?1 AND game = ?2",
            params![entry_id, game.as_str()],
        )?
    } else {
        let name = e.name.as_ref().map(|s| s.trim().to_string());
        conn.execute(
            "UPDATE loot_inventory_entries SET
                name = CASE WHEN ?3 IS NULL THEN name WHEN ?3 = '' THEN NULL ELSE ?3 END,
                quantity = CASE WHEN ?4 IS NULL THEN quantity WHEN ?4 = 0 THEN NULL ELSE ?4 END,
                corrected = CASE WHEN ?3 IS NULL AND ?4 IS NULL THEN corrected ELSE 1 END,
                excluded = COALESCE(?5, excluded)
             WHERE id = ?1 AND game = ?2",
            params![entry_id, game.as_str(), name, e.quantity, e.excluded.map(|b| b as i64)],
        )?
    };
    if n == 0 {
        return Err(AppError::InvalidInput("Entry not found.".into()));
    }
    Ok(())
}

/// review → confirmed / cancelled (and back to review). Cancelled snapshots never count in changes.
pub fn set_status(conn: &Connection, game: GameId, id: i64, status: &str, now: i64) -> AppResult<()> {
    if !matches!(status, "review" | "confirmed" | "cancelled") {
        return Err(AppError::InvalidInput("Unknown status.".into()));
    }
    let n = conn.execute(
        "UPDATE loot_inventory_snapshots SET status = ?3, confirmed_at = CASE WHEN ?3 = 'confirmed' THEN ?4 ELSE NULL END WHERE game = ?1 AND id = ?2",
        params![game.as_str(), id, status, now],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("Snapshot not found.".into()));
    }
    Ok(())
}

pub fn set_baseline(conn: &Connection, game: GameId, id: i64, on: bool) -> AppResult<()> {
    let n = conn.execute("UPDATE loot_inventory_snapshots SET is_baseline = ?3 WHERE game = ?1 AND id = ?2", params![game.as_str(), id, on as i64])?;
    if n == 0 {
        return Err(AppError::InvalidInput("Snapshot not found.".into()));
    }
    Ok(())
}

pub fn assign_map(conn: &Connection, game: GameId, id: i64, map_id: Option<i64>) -> AppResult<()> {
    if let Some(m) = map_id {
        let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM loot_map_runs WHERE game = ?1 AND id = ?2)", params![game.as_str(), m], |r| r.get(0))?;
        if !ok {
            return Err(AppError::InvalidInput("Map not found.".into()));
        }
    }
    let n = conn.execute(
        "UPDATE loot_inventory_snapshots SET map_run_id = ?3, map_assignment = CASE WHEN ?3 IS NULL THEN NULL ELSE 'user' END WHERE game = ?1 AND id = ?2",
        params![game.as_str(), id, map_id],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("Snapshot not found.".into()));
    }
    Ok(())
}

/// Deletes a snapshot; returns its image file name (for the caller to remove).
pub fn delete(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<String>> {
    let file: Option<Option<String>> =
        conn.query_row("SELECT image_file FROM loot_inventory_snapshots WHERE game = ?1 AND id = ?2", params![game.as_str(), id], |r| r.get(0)).optional()?;
    conn.execute("DELETE FROM loot_inventory_snapshots WHERE game = ?1 AND id = ?2", params![game.as_str(), id])?;
    Ok(file.flatten())
}

/// The snapshot a new one is compared with by default: the latest confirmed one taken before it.
pub fn previous_confirmed(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT p.id FROM loot_inventory_snapshots p, loot_inventory_snapshots s
             WHERE s.game = ?1 AND s.id = ?2 AND p.game = ?1 AND p.id != s.id AND p.status = 'confirmed'
               AND (p.taken_at < s.taken_at OR (p.taken_at = s.taken_at AND p.id < s.id))
             ORDER BY p.taken_at DESC, p.id DESC LIMIT 1",
            params![game.as_str(), id],
            |r| r.get(0),
        )
        .optional()?)
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Total {
    pub quantity: i64,
    pub uncertain: bool,
    pub category: Option<String>,
}

/// Quantity per item over the counted (not excluded, named) cells.
pub fn totals(entries: &[Entry]) -> BTreeMap<String, Total> {
    let mut out: BTreeMap<String, Total> = BTreeMap::new();
    for e in entries.iter().filter(|e| !e.excluded) {
        let Some(name) = &e.name else { continue };
        let t = out.entry(name.clone()).or_default();
        t.quantity += e.quantity.unwrap_or(0);
        t.uncertain |= e.uncertain();
        if t.category.is_none() {
            t.category = e.recognized_category.clone().filter(|_| e.recognized_name.as_deref() == Some(name.as_str()));
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaLine {
    pub name: String,
    pub category: Option<String>,
    pub before: i64,
    pub after: i64,
    pub change: i64,
    /// confirmed | estimated | needs_review
    pub status: &'static str,
    /// Market value per unit (base unit) for the snapshot's league, when listed.
    pub unit_value: Option<f64>,
    pub value: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    pub snapshot_id: i64,
    /// None = no earlier confirmed snapshot to compare with.
    pub against_id: Option<i64>,
    pub lines: Vec<DeltaLine>,
    /// Sum of priced positive changes that aren't waiting for review (base unit).
    pub estimated_gain: f64,
    pub needs_review: usize,
}

/// Inventory change from `against` to `id` (both of `game`).
pub fn delta(conn: &Connection, game: GameId, id: i64, against: Option<i64>, price: &dyn Fn(&str) -> Option<f64>) -> AppResult<Delta> {
    let Some(snap) = get(conn, game, id)? else { return Err(AppError::InvalidInput("Snapshot not found.".into())) };
    let after = totals(&entries(conn, game, id)?);
    let (against_id, before, before_confirmed) = match against {
        Some(a) => {
            let Some(p) = get(conn, game, a)? else { return Err(AppError::InvalidInput("Snapshot to compare with not found.".into())) };
            (Some(a), totals(&entries(conn, game, a)?), p.status == "confirmed")
        }
        None => (None, BTreeMap::new(), false),
    };
    let mut names: Vec<&String> = after.keys().chain(before.keys()).collect();
    names.sort();
    names.dedup();
    let mut lines = Vec::new();
    for name in names {
        let a = after.get(name).cloned().unwrap_or_default();
        let b = before.get(name).cloned().unwrap_or_default();
        let change = a.quantity - b.quantity;
        if against_id.is_some() && change == 0 && !a.uncertain && !b.uncertain {
            continue;
        }
        let status = if a.uncertain || b.uncertain {
            "needs_review"
        } else if snap.status == "confirmed" && before_confirmed {
            "confirmed"
        } else {
            "estimated"
        };
        let unit_value = price(name);
        lines.push(DeltaLine {
            name: name.clone(),
            category: a.category.or(b.category),
            before: b.quantity,
            after: a.quantity,
            change,
            status,
            unit_value,
            value: unit_value.map(|u| u * change as f64),
        });
    }
    lines.sort_by(|x, y| y.value.unwrap_or(0.0).abs().total_cmp(&x.value.unwrap_or(0.0).abs()).then(x.name.cmp(&y.name)));
    let estimated_gain = lines.iter().filter(|l| l.status != "needs_review" && l.change > 0).filter_map(|l| l.value).sum();
    let needs_review = lines.iter().filter(|l| l.status == "needs_review").count();
    Ok(Delta { snapshot_id: id, against_id, lines, estimated_gain, needs_review })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn cell(col: usize, name: Option<&str>, qty: Option<u32>, conf: Confidence) -> CellResult {
        CellResult {
            col,
            row: 0,
            name: name.map(Into::into),
            category: Some("currency".into()),
            icon_score: 0.8,
            alternatives: vec!["Greater Exalted Orb".into()],
            tier_strokes: 0,
            quantity: qty,
            quantity_confidence: 0.6,
            icon_confidence: conf,
            confidence: conf,
        }
    }

    fn snap(c: &Connection, at: i64, cells: &[CellResult]) -> i64 {
        let g = Grid { left: 1.0, top: 2.0, cell: 3.0, score: 9.0 };
        insert(c, GameId::Poe2, &NewSnapshot { taken_at: at, source: "file", session_id: None, map_run_id: None, screen_w: 2560, screen_h: 1440, grid: &g, image_file: None, league: Some("Rise".into()), cells }).unwrap()
    }

    #[test]
    fn baseline_snapshot_change_with_review_states() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let price = |n: &str| match n {
            "Exalted Orb" => Some(1.0),
            "Divine Orb" => Some(300.0),
            _ => None,
        };
        let base = snap(&c, 100, &[cell(0, Some("Exalted Orb"), Some(20), Confidence::High), cell(1, Some("Divine Orb"), Some(8), Confidence::High), cell(2, Some("Chaos Orb"), Some(450), Confidence::High)]);
        set_baseline(&c, GameId::Poe2, base, true).unwrap();
        set_status(&c, GameId::Poe2, base, "confirmed", 101).unwrap();
        let after = snap(
            &c,
            200,
            &[
                cell(0, Some("Exalted Orb"), Some(20), Confidence::High),
                cell(1, Some("Exalted Orb"), Some(7), Confidence::High),
                cell(2, Some("Divine Orb"), Some(9), Confidence::High),
                cell(3, Some("Chaos Orb"), Some(400), Confidence::Low),
                cell(4, None, None, Confidence::Unknown),
            ],
        );
        assert_eq!(previous_confirmed(&c, GameId::Poe2, after).unwrap(), Some(base));
        let s = get(&c, GameId::Poe2, after).unwrap().unwrap();
        assert_eq!((s.status.as_str(), s.cells, s.to_review), ("review", 5, 2));
        let d = delta(&c, GameId::Poe2, after, Some(base), &price).unwrap();
        let line = |n: &str| d.lines.iter().find(|l| l.name == n).unwrap().clone();
        assert_eq!((line("Exalted Orb").change, line("Exalted Orb").status), (7, "estimated"));
        assert_eq!((line("Divine Orb").change, line("Divine Orb").value), (1, Some(300.0)));
        assert_eq!((line("Chaos Orb").change, line("Chaos Orb").status), (-50, "needs_review"), "a low-confidence cell is never trusted");
        assert_eq!(d.estimated_gain, 307.0, "uncertain lines and losses don't count as gain");
        assert_eq!(d.needs_review, 1);

        // The user corrects the chaos stack and excludes the unknown cell, then confirms.
        let es = entries(&c, GameId::Poe2, after).unwrap();
        let chaos = es.iter().find(|e| e.col == 3).unwrap().id;
        let unknown = es.iter().find(|e| e.col == 4).unwrap().id;
        edit_entry(&c, GameId::Poe2, chaos, &EntryEdit { quantity: Some(450), ..Default::default() }).unwrap();
        edit_entry(&c, GameId::Poe2, unknown, &EntryEdit { excluded: Some(true), ..Default::default() }).unwrap();
        set_status(&c, GameId::Poe2, after, "confirmed", 201).unwrap();
        let d = delta(&c, GameId::Poe2, after, Some(base), &price).unwrap();
        assert!(d.lines.iter().all(|l| l.status == "confirmed"), "{d:?}");
        assert!(d.lines.iter().all(|l| l.name != "Chaos Orb"), "unchanged lines are left out");
        let e = entries(&c, GameId::Poe2, after).unwrap().into_iter().find(|e| e.id == chaos).unwrap();
        assert_eq!((e.recognized_quantity, e.quantity, e.corrected), (Some(400), Some(450), true), "the original recognition is kept");
        edit_entry(&c, GameId::Poe2, chaos, &EntryEdit { reset: Some(true), ..Default::default() }).unwrap();
        assert_eq!(entries(&c, GameId::Poe2, after).unwrap().into_iter().find(|e| e.id == chaos).unwrap().quantity, Some(400));

        // A cancelled snapshot is never the comparison point.
        let later = snap(&c, 300, &[cell(0, Some("Exalted Orb"), Some(1), Confidence::High)]);
        set_status(&c, GameId::Poe2, after, "cancelled", 0).unwrap();
        assert_eq!(previous_confirmed(&c, GameId::Poe2, later).unwrap(), Some(base));
        assert!(edit_entry(&c, GameId::Poe2, chaos, &EntryEdit { quantity: Some(-1), ..Default::default() }).is_err());
        assert!(list(&c, GameId::Poe1, 10).unwrap().is_empty(), "game isolation");
    }

    #[test]
    fn reprocessing_keeps_user_corrections() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let id = snap(&c, 100, &[cell(0, Some("Regal Orb"), Some(2), Confidence::Low), cell(1, Some("Vaal Orb"), Some(1), Confidence::Low)]);
        let es = entries(&c, GameId::Poe2, id).unwrap();
        edit_entry(&c, GameId::Poe2, es[0].id, &EntryEdit { name: Some("Greater Regal Orb".into()), quantity: Some(20), ..Default::default() }).unwrap();
        edit_entry(&c, GameId::Poe2, es[1].id, &EntryEdit { excluded: Some(true), ..Default::default() }).unwrap();
        replace_recognition(&c, GameId::Poe2, id, &[cell(0, Some("Regal Orb"), Some(20), Confidence::High), cell(1, Some("Vaal Orb"), Some(1), Confidence::High)]).unwrap();
        let es = entries(&c, GameId::Poe2, id).unwrap();
        assert_eq!((es[0].name.as_deref(), es[0].quantity, es[0].recognized_quantity, es[0].corrected), (Some("Greater Regal Orb"), Some(20), Some(20), true));
        assert!(es[1].excluded);
        assert_eq!(delete(&c, GameId::Poe2, id).unwrap(), None);
        assert!(entries(&c, GameId::Poe2, id).unwrap().is_empty(), "entries go with the snapshot");
    }
}
