//! SQLite access for Loot Journal (tables from 0007_loot.sql). Every query is
//! scoped by `game`; callers pass a `Connection` so writes can share a transaction.

use super::item_text::Header;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

/// Repeated clipboard notifications for the same copy arrive within this window.
pub const DEBOUNCE_SECS: i64 = 3;
const MAX_EVENTS: i64 = 2000;
const MAX_TAGS: usize = 20;
const MAX_TAG_LEN: usize = 32;
const MAX_NOTES: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateMode {
    /// The same item copied again updates the existing entry (count + last time).
    Merge,
    /// A new entry when the last copy is older than the cooldown; otherwise merge.
    Cooldown,
    /// Every copy is a new entry (repeated notifications are still debounced).
    Always,
}

#[derive(Debug, Clone, Default)]
pub struct CaptureContext {
    pub now: i64,
    pub session_id: Option<i64>,
    pub area_name: Option<String>,
    pub area_kind: Option<String>,
    pub session_elapsed_secs: Option<i64>,
    /// Map record the copy belongs to (see maps.rs), when reliable.
    pub map_run_id: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureOutcome {
    New(i64),
    /// Merged into an existing entry (same item copied again).
    Merged(i64),
    /// A repeated notification of the same copy (ignored).
    Debounced(i64),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LootItem {
    pub id: i64,
    pub fingerprint: String,
    pub item_class: String,
    pub rarity: String,
    pub item_name: Option<String>,
    pub base_type: String,
    pub category: String,
    pub icon: Option<String>,
    pub item_level: Option<i64>,
    pub stack_size: Option<i64>,
    pub quality: Option<i64>,
    pub corrupted: bool,
    pub unidentified: bool,
    pub parser_confidence: String,
    pub parser_warnings: Vec<String>,
    pub captured_at: i64,
    pub last_captured_at: i64,
    pub capture_count: i64,
    pub source: String,
    pub session_id: Option<i64>,
    pub capture_area_name: Option<String>,
    pub capture_area_kind: Option<String>,
    pub session_elapsed_secs: Option<i64>,
    pub origin_status: String,
    pub origin_note: Option<String>,
    pub status: String,
    pub favorite: bool,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub value_status: String,
    pub value_total: Option<f64>,
    pub value_checked_at: Option<i64>,
    /// Note of the latest valuation (e.g. the range of an unidentified unique).
    pub value_note: Option<String>,
    /// Latest valuation: source ("poe.ninja", "user"…), confidence, market data time and league.
    pub value_source: Option<String>,
    pub value_confidence: Option<String>,
    pub value_fetched_at: Option<i64>,
    pub value_league: Option<String>,
    /// First known value (at capture time), kept apart from the current one.
    pub value_at_capture: Option<f64>,
    pub map_run_id: Option<i64>,
    /// "auto" (copied inside the map) or "user" (assigned by the user).
    pub map_assignment: Option<String>,
    pub verified: bool,
    /// Category / quantity corrected by the user (the recognised values are kept).
    pub original_category: Option<String>,
    pub original_stack_size: Option<i64>,
}

const COLS: &str = "id, fingerprint, item_class, rarity, item_name, base_type, category, icon, item_level, stack_size, quality, corrupted, unidentified, \
    parser_confidence, parser_warnings, captured_at, last_captured_at, capture_count, source, session_id, capture_area_name, capture_area_kind, \
    session_elapsed_secs, origin_status, origin_note, status, favorite, notes, tags, value_status, value_total, value_checked_at, \
    (SELECT json_array(v.note, v.source, v.confidence, v.data_fetched_at, v.league) FROM loot_valuations v WHERE v.item_id = loot_items.id ORDER BY v.at DESC, v.id DESC LIMIT 1), \
    (SELECT v.total_value FROM loot_valuations v WHERE v.item_id = loot_items.id AND v.status IN ('priced', 'manual') AND v.total_value IS NOT NULL ORDER BY v.at, v.id LIMIT 1), \
    map_run_id, map_assignment, verified, original_category, original_stack_size";

fn json_list(s: String) -> Vec<String> {
    serde_json::from_str(&s).unwrap_or_default()
}

fn item_row(r: &Row<'_>) -> rusqlite::Result<LootItem> {
    let latest_json: Option<String> = r.get(32)?;
    let latest_v: Option<serde_json::Value> = latest_json.and_then(|s| serde_json::from_str(&s).ok());
    let latest = |k: usize| latest_v.as_ref().and_then(|v| v.get(k)).cloned();
    Ok(LootItem {
        id: r.get(0)?,
        fingerprint: r.get(1)?,
        item_class: r.get(2)?,
        rarity: r.get(3)?,
        item_name: r.get(4)?,
        base_type: r.get(5)?,
        category: r.get(6)?,
        icon: r.get(7)?,
        item_level: r.get(8)?,
        stack_size: r.get(9)?,
        quality: r.get(10)?,
        corrupted: r.get::<_, i64>(11)? == 1,
        unidentified: r.get::<_, i64>(12)? == 1,
        parser_confidence: r.get(13)?,
        parser_warnings: json_list(r.get(14)?),
        captured_at: r.get(15)?,
        last_captured_at: r.get(16)?,
        capture_count: r.get(17)?,
        source: r.get(18)?,
        session_id: r.get(19)?,
        capture_area_name: r.get(20)?,
        capture_area_kind: r.get(21)?,
        session_elapsed_secs: r.get(22)?,
        origin_status: r.get(23)?,
        origin_note: r.get(24)?,
        status: r.get(25)?,
        favorite: r.get::<_, i64>(26)? == 1,
        notes: r.get(27)?,
        tags: json_list(r.get(28)?),
        value_status: r.get(29)?,
        value_total: r.get(30)?,
        value_checked_at: r.get(31)?,
        value_note: latest(0).and_then(|v| v.as_str().map(str::to_owned)),
        value_source: latest(1).and_then(|v| v.as_str().map(str::to_owned)),
        value_confidence: latest(2).and_then(|v| v.as_str().map(str::to_owned)),
        value_fetched_at: latest(3).and_then(|v| v.as_i64()),
        value_league: latest(4).and_then(|v| v.as_str().map(str::to_owned)),
        value_at_capture: r.get(33)?,
        map_run_id: r.get(34)?,
        map_assignment: r.get(35)?,
        verified: r.get::<_, i64>(36)? == 1,
        original_category: r.get(37)?,
        original_stack_size: r.get(38)?,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Valuation {
    pub id: i64,
    pub at: i64,
    pub status: String,
    pub unit_value: Option<f64>,
    pub quantity: i64,
    pub total_value: Option<f64>,
    pub unit: String,
    pub source: String,
    pub market_category: Option<String>,
    pub league: Option<String>,
    pub confidence: Option<String>,
    pub data_fetched_at: Option<i64>,
    pub note: Option<String>,
}

/// A valuation to record (see valuation.rs).
#[derive(Debug, Clone, PartialEq)]
pub struct NewValuation {
    pub status: &'static str,
    pub unit_value: Option<f64>,
    pub quantity: i64,
    pub unit: &'static str,
    pub source: String,
    pub market_category: Option<String>,
    pub league: Option<String>,
    pub confidence: Option<&'static str>,
    pub data_fetched_at: Option<i64>,
    pub note: Option<String>,
    pub icon: Option<String>,
}

impl NewValuation {
    pub fn total(&self) -> Option<f64> {
        self.unit_value.map(|v| v * self.quantity as f64)
    }
}

// ---------- capture ----------

pub fn log_event(conn: &Connection, game: GameId, at: i64, kind: &str, fingerprint: Option<&str>, item_id: Option<i64>, detail: Option<&str>) -> AppResult<()> {
    conn.execute(
        "INSERT INTO loot_capture_events (game, at, kind, fingerprint, item_id, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![game.as_str(), at, kind, fingerprint, item_id, detail],
    )?;
    conn.execute(
        "DELETE FROM loot_capture_events WHERE game = ?1 AND id <= (SELECT id FROM loot_capture_events WHERE game = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)",
        params![game.as_str(), MAX_EVENTS],
    )?;
    Ok(())
}

/// Records a recognised item copy, applying duplicate handling.
pub fn capture(conn: &Connection, game: GameId, raw: &str, h: &Header, fp: &str, ctx: &CaptureContext, mode: DuplicateMode, cooldown_secs: i64, source: &str) -> AppResult<CaptureOutcome> {
    let latest: Option<(i64, i64)> = conn
        .query_row(
            "SELECT id, last_captured_at FROM loot_items WHERE game = ?1 AND fingerprint = ?2 ORDER BY last_captured_at DESC, id DESC LIMIT 1",
            params![game.as_str(), fp],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, last)) = latest {
        if (ctx.now - last).abs() < DEBOUNCE_SECS {
            return Ok(CaptureOutcome::Debounced(id));
        }
        let merge = match mode {
            DuplicateMode::Merge => true,
            DuplicateMode::Cooldown => ctx.now - last < cooldown_secs,
            DuplicateMode::Always => false,
        };
        if merge {
            conn.execute(
                "UPDATE loot_items SET last_captured_at = MAX(last_captured_at, ?2), capture_count = capture_count + 1 WHERE id = ?1",
                params![id, ctx.now],
            )?;
            log_event(conn, game, ctx.now, "duplicate", Some(fp), Some(id), Some("Same item copied again; merged into the existing entry."))?;
            return Ok(CaptureOutcome::Merged(id));
        }
    }
    conn.execute(
        "INSERT INTO loot_items (game, fingerprint, raw_text, item_class, rarity, item_name, base_type, category, item_level, stack_size, quality,
            corrupted, unidentified, parser_confidence, parser_warnings, captured_at, last_captured_at, source, session_id, capture_area_name,
            capture_area_kind, session_elapsed_secs, map_run_id, map_assignment)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?17, ?18, ?19, ?20, ?21, ?22,
                 CASE WHEN ?22 IS NULL THEN NULL ELSE 'auto' END)",
        params![
            game.as_str(),
            fp,
            raw,
            h.item_class,
            h.rarity,
            h.name,
            h.base_type,
            h.category,
            h.item_level,
            h.stack_size,
            h.quality,
            h.corrupted as i64,
            h.unidentified as i64,
            h.confidence,
            serde_json::to_string(&h.warnings)?,
            ctx.now,
            source,
            ctx.session_id,
            ctx.area_name,
            ctx.area_kind,
            ctx.session_elapsed_secs,
            ctx.map_run_id,
        ],
    )?;
    let id = conn.last_insert_rowid();
    log_event(conn, game, ctx.now, "captured", Some(fp), Some(id), None)?;
    Ok(CaptureOutcome::New(id))
}

// ---------- valuation ----------

/// Appends a valuation when it differs from the latest one and updates the
/// item's current value. Returns true when a history row was added.
pub fn record_valuation(conn: &Connection, game: GameId, item_id: i64, v: &NewValuation, now: i64) -> AppResult<bool> {
    let last: Option<(String, Option<f64>, i64, Option<String>)> = conn
        .query_row(
            "SELECT status, total_value, quantity, note FROM loot_valuations WHERE item_id = ?1 ORDER BY at DESC, id DESC LIMIT 1",
            params![item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let total = v.total();
    let changed = match &last {
        None => true,
        Some((st, tv, q, note)) => {
            st != v.status
                || *q != v.quantity
                || *note != v.note
                || match (tv, total) {
                    (Some(a), Some(b)) => (a - b).abs() > 0.005 * a.abs().max(b.abs()).max(1e-9),
                    (None, None) => false,
                    _ => true,
                }
        }
    };
    if changed {
        conn.execute(
            "INSERT INTO loot_valuations (item_id, game, at, status, unit_value, quantity, total_value, unit, source, market_category, league, confidence, data_fetched_at, note)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![item_id, game.as_str(), now, v.status, v.unit_value, v.quantity, total, v.unit, v.source, v.market_category, v.league, v.confidence, v.data_fetched_at, v.note],
        )?;
    }
    conn.execute(
        "UPDATE loot_items SET value_status = ?2, value_total = ?3, value_checked_at = ?4,
           value_checks = CASE WHEN value_status = ?2 THEN value_checks + 1 ELSE 1 END, icon = COALESCE(icon, ?5) WHERE id = ?1",
        params![item_id, v.status, total, now, v.icon],
    )?;
    Ok(changed)
}

pub fn valuations(conn: &Connection, item_id: i64) -> AppResult<Vec<Valuation>> {
    let mut stmt = conn.prepare(
        "SELECT id, at, status, unit_value, quantity, total_value, unit, source, market_category, league, confidence, data_fetched_at, note
         FROM loot_valuations WHERE item_id = ?1 ORDER BY at, id",
    )?;
    let rows = stmt.query_map(params![item_id], |r| {
        Ok(Valuation {
            id: r.get(0)?,
            at: r.get(1)?,
            status: r.get(2)?,
            unit_value: r.get(3)?,
            quantity: r.get(4)?,
            total_value: r.get(5)?,
            unit: r.get(6)?,
            source: r.get(7)?,
            market_category: r.get(8)?,
            league: r.get(9)?,
            confidence: r.get(10)?,
            data_fetched_at: r.get(11)?,
            note: r.get(12)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// What the valuation pass needs to know about an item.
#[derive(Debug, Clone, PartialEq)]
pub struct ValueTarget {
    pub id: i64,
    pub category: String,
    pub rarity: String,
    pub base_type: String,
    pub stack_size: Option<i64>,
    pub value_status: String,
    pub value_checks: i64,
    pub item_class: String,
    pub item_name: Option<String>,
    pub corrupted: bool,
    pub unidentified: bool,
}

const TARGET_COLS: &str = "id, category, rarity, base_type, stack_size, value_status, value_checks, item_class, item_name, corrupted, unidentified";

fn target_row(r: &Row<'_>) -> rusqlite::Result<ValueTarget> {
    Ok(ValueTarget {
        id: r.get(0)?,
        category: r.get(1)?,
        rarity: r.get(2)?,
        base_type: r.get(3)?,
        stack_size: r.get(4)?,
        value_status: r.get(5)?,
        value_checks: r.get(6)?,
        item_class: r.get(7)?,
        item_name: r.get(8)?,
        corrupted: r.get::<_, i64>(9)? == 1,
        unidentified: r.get::<_, i64>(10)? == 1,
    })
}

/// Items to (re)value: never valued, market-priced and older than `interval`,
/// or without market data: retried every `retry_secs` for the first
/// `max_retries` checks since the status last changed, then every `interval`
/// (poe.ninja lists only recently traded items, so an unlisted item can appear
/// later). Unsupported and manually valued items are never rechecked.
pub fn due_for_valuation(conn: &Connection, game: GameId, now: i64, interval_secs: i64, retry_secs: i64, max_retries: i64, limit: i64) -> AppResult<Vec<ValueTarget>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TARGET_COLS} FROM loot_items
         WHERE game = ?1 AND (
            value_status = 'pending'
            OR (value_status = 'priced' AND ?3 > 0 AND COALESCE(value_checked_at, 0) <= ?2 - ?3)
            OR (value_status = 'no_market_data' AND (
                (value_checks < ?5 AND COALESCE(value_checked_at, 0) <= ?2 - ?4)
                OR (?3 > 0 AND COALESCE(value_checked_at, 0) <= ?2 - ?3))))
         ORDER BY COALESCE(value_checked_at, 0) LIMIT ?6"
    ))?;
    let rows = stmt.query_map(params![game.as_str(), now, interval_secs, retry_secs, max_retries, limit], target_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Queues items whose latest market valuation was for another league (the user
/// switched leagues). Manual and unsupported items are left alone.
pub fn requeue_other_league(conn: &Connection, game: GameId, league: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE loot_items SET value_status = 'pending', value_checks = 0
         WHERE game = ?1 AND value_status IN ('priced', 'no_market_data')
           AND COALESCE((SELECT v.league FROM loot_valuations v WHERE v.item_id = loot_items.id ORDER BY v.at DESC, v.id DESC LIMIT 1), '') != ?2",
        params![game.as_str(), league],
    )?)
}

/// The most recent poe.ninja price recorded for this item — or, for a
/// non-unique item, for another capture with the same base type — in `league`.
#[derive(Debug, Clone, PartialEq)]
pub struct LastListed {
    pub unit_value: f64,
    pub market_category: Option<String>,
    /// When poe.ninja's data was fetched (falls back to the valuation time).
    pub seen_at: i64,
}

pub fn last_listed(conn: &Connection, game: GameId, league: &str, t: &ValueTarget) -> AppResult<Option<LastListed>> {
    Ok(conn
        .query_row(
            "SELECT v.unit_value, v.market_category, COALESCE(v.data_fetched_at, v.at) AS seen
             FROM loot_valuations v JOIN loot_items i ON i.id = v.item_id
             WHERE v.game = ?1 AND i.game = ?1 AND v.status = 'priced' AND v.source = 'poe.ninja' AND v.league = ?2
               AND v.unit_value IS NOT NULL
               AND (v.item_id = ?3 OR (?4 = 0 AND i.rarity != 'Unique' AND i.base_type = ?5))
             ORDER BY seen DESC, v.id DESC LIMIT 1",
            params![game.as_str(), league, t.id, (t.rarity == "Unique") as i64, t.base_type],
            |r| Ok(LastListed { unit_value: r.get(0)?, market_category: r.get(1)?, seen_at: r.get(2)? }),
        )
        .optional()?)
}

pub fn value_target(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<ValueTarget>> {
    Ok(conn
        .query_row(&format!("SELECT {TARGET_COLS} FROM loot_items WHERE game = ?1 AND id = ?2"), params![game.as_str(), id], target_row)
        .optional()?)
}

// ---------- queries ----------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryQuery {
    /// Matches name, base type and modifier text (the raw copy).
    pub search: Option<String>,
    pub category: Option<String>,
    pub rarity: Option<String>,
    pub status: Option<String>,
    pub value_status: Option<String>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub session_id: Option<i64>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub favorites_only: Option<bool>,
    /// Not priced (no market data, manual valuation required, pending).
    pub unpriced_only: Option<bool>,
    pub verified_only: Option<bool>,
    pub map_run_id: Option<i64>,
    /// newest (default) | oldest | value_desc | value_asc | quantity | category
    pub sort: Option<String>,
    pub limit: Option<i64>,
}

fn like(s: &str) -> String {
    let esc: String = s.chars().take(80).flat_map(|c| if matches!(c, '%' | '_' | '\\') { vec!['\\', c] } else { vec![c] }).collect();
    format!("%{esc}%")
}

pub fn list(conn: &Connection, game: GameId, q: &LibraryQuery) -> AppResult<Vec<LootItem>> {
    let order = match q.sort.as_deref().unwrap_or("newest") {
        "newest" => "last_captured_at DESC, id DESC",
        "oldest" => "captured_at ASC, id ASC",
        "value_desc" => "value_total IS NULL, value_total DESC, id DESC",
        "value_asc" => "value_total IS NULL, value_total ASC, id DESC",
        "category" => "category ASC, last_captured_at DESC",
        "quantity" => "COALESCE(stack_size, 1) * capture_count DESC, last_captured_at DESC",
        _ => return Err(AppError::InvalidInput("Unknown sort order.".into())),
    };
    let search = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(like);
    let sql = format!(
        "SELECT {COLS} FROM loot_items WHERE game = ?1
           AND (?2 IS NULL OR item_name LIKE ?2 ESCAPE '\\' OR base_type LIKE ?2 ESCAPE '\\' OR raw_text LIKE ?2 ESCAPE '\\')
           AND (?3 IS NULL OR category = ?3) AND (?4 IS NULL OR rarity = ?4) AND (?5 IS NULL OR status = ?5)
           AND (?6 IS NULL OR value_status = ?6) AND (?7 IS NULL OR value_total >= ?7) AND (?8 IS NULL OR value_total <= ?8)
           AND (?9 IS NULL OR session_id = ?9) AND (?10 IS NULL OR captured_at >= ?10) AND (?11 IS NULL OR captured_at < ?11)
           AND (?12 = 0 OR favorite = 1)
           AND (?14 = 0 OR value_status NOT IN ('priced', 'manual') OR value_total IS NULL)
           AND (?15 = 0 OR verified = 1) AND (?16 IS NULL OR map_run_id = ?16)
         ORDER BY {order} LIMIT ?13"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![
            game.as_str(),
            search,
            q.category,
            q.rarity,
            q.status,
            q.value_status,
            q.min_value,
            q.max_value,
            q.session_id,
            q.from,
            q.to,
            q.favorites_only.unwrap_or(false) as i64,
            q.limit.unwrap_or(500).clamp(1, 20_000),
            q.unpriced_only.unwrap_or(false) as i64,
            q.verified_only.unwrap_or(false) as i64,
            q.map_run_id,
        ],
        item_row,
    )?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<LootItem>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM loot_items WHERE game = ?1 AND id = ?2"), params![game.as_str(), id], item_row).optional()?)
}

pub fn raw_text(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<String>> {
    Ok(conn.query_row("SELECT raw_text FROM loot_items WHERE game = ?1 AND id = ?2", params![game.as_str(), id], |r| r.get(0)).optional()?)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemEdit {
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub favorite: Option<bool>,
    pub origin_status: Option<String>,
    pub origin_note: Option<String>,
    /// "I checked this item" (manual verification).
    pub verified: Option<bool>,
    /// Corrections of the recognised category / stack size (the raw copy is unchanged).
    pub category: Option<String>,
    pub stack_size: Option<i64>,
    /// Restores the recognised category and stack size.
    pub reset_corrections: Option<bool>,
}

/// Categories an item can be filed under (same keys as the UI's CATEGORY_LABEL).
pub const CATEGORIES: &[&str] = &[
    "currency", "socketable", "omen", "fragment", "weapon", "armour", "accessory", "flask", "jewel", "relic", "unique", "skill_gem", "support_gem",
    "waystone", "tablet", "other",
];

impl ItemEdit {
    /// True when the edit changes what the item is worth (quantity) and it must be valued again.
    pub fn needs_revalue(&self) -> bool {
        self.stack_size.is_some() || self.reset_corrections == Some(true)
    }
}

/// Edits user fields only; the captured raw text and parsed header never change.
pub fn edit(conn: &Connection, game: GameId, id: i64, e: &ItemEdit) -> AppResult<()> {
    if let Some(s) = &e.status {
        if !matches!(s.as_str(), "captured" | "kept" | "sold" | "discarded") {
            return Err(AppError::InvalidInput("Unknown status.".into()));
        }
    }
    if let Some(s) = &e.origin_status {
        if !matches!(s.as_str(), "unknown" | "user_confirmed_drop" | "user_not_a_drop") {
            return Err(AppError::InvalidInput("Unknown origin.".into()));
        }
    }
    let tags = match &e.tags {
        Some(t) => {
            let clean: Vec<String> = t.iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
            if clean.len() > MAX_TAGS || clean.iter().any(|x| x.chars().count() > MAX_TAG_LEN) {
                return Err(AppError::InvalidInput(format!("Up to {MAX_TAGS} tags of at most {MAX_TAG_LEN} characters.")));
            }
            Some(serde_json::to_string(&clean)?)
        }
        None => None,
    };
    if let Some(c) = &e.category {
        if !CATEGORIES.contains(&c.as_str()) {
            return Err(AppError::InvalidInput("Unknown category.".into()));
        }
    }
    if let Some(n) = e.stack_size {
        if !(1..=1_000_000).contains(&n) {
            return Err(AppError::InvalidInput("Quantity must be between 1 and 1,000,000.".into()));
        }
    }
    if e.reset_corrections == Some(true) {
        conn.execute(
            "UPDATE loot_items SET category = COALESCE(original_category, category), stack_size = CASE WHEN original_stack_size IS NOT NULL THEN original_stack_size ELSE stack_size END,
                original_category = NULL, original_stack_size = NULL WHERE game = ?1 AND id = ?2",
            params![game.as_str(), id],
        )?;
    }
    if let Some(c) = &e.category {
        conn.execute(
            "UPDATE loot_items SET original_category = COALESCE(original_category, category), category = ?3 WHERE game = ?1 AND id = ?2 AND category != ?3",
            params![game.as_str(), id, c],
        )?;
        conn.execute("UPDATE loot_items SET original_category = NULL WHERE game = ?1 AND id = ?2 AND original_category = category", params![game.as_str(), id])?;
    }
    if let Some(n) = e.stack_size {
        conn.execute(
            "UPDATE loot_items SET original_stack_size = COALESCE(original_stack_size, stack_size, 1), stack_size = ?3 WHERE game = ?1 AND id = ?2 AND COALESCE(stack_size, 1) != ?3",
            params![game.as_str(), id, n],
        )?;
        conn.execute("UPDATE loot_items SET original_stack_size = NULL WHERE game = ?1 AND id = ?2 AND original_stack_size = stack_size", params![game.as_str(), id])?;
    }
    let cap = |s: &Option<String>| s.as_ref().map(|x| x.chars().take(MAX_NOTES).collect::<String>());
    let n = conn.execute(
        "UPDATE loot_items SET notes = COALESCE(?3, notes), tags = COALESCE(?4, tags), status = COALESCE(?5, status),
            favorite = COALESCE(?6, favorite), origin_status = COALESCE(?7, origin_status), origin_note = COALESCE(?8, origin_note),
            verified = COALESCE(?9, verified)
         WHERE game = ?1 AND id = ?2",
        params![game.as_str(), id, cap(&e.notes), tags, e.status, e.favorite.map(|b| b as i64), e.origin_status, cap(&e.origin_note), e.verified.map(|b| b as i64)],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("Item not found.".into()));
    }
    Ok(())
}

pub fn delete(conn: &Connection, game: GameId, ids: &[i64]) -> AppResult<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute("DELETE FROM loot_items WHERE game = ?1 AND id = ?2", params![game.as_str(), id])?;
    }
    Ok(n)
}

pub fn clear(conn: &Connection, game: GameId) -> AppResult<usize> {
    conn.execute("DELETE FROM loot_capture_events WHERE game = ?1", params![game.as_str()])?;
    Ok(conn.execute("DELETE FROM loot_items WHERE game = ?1", params![game.as_str()])?)
}

pub fn apply_retention(conn: &Connection, game: GameId, days: u32, now: i64) -> AppResult<usize> {
    if days == 0 {
        return Ok(0);
    }
    Ok(conn.execute(
        "DELETE FROM loot_items WHERE game = ?1 AND favorite = 0 AND last_captured_at < ?2",
        params![game.as_str(), now - days as i64 * 86_400],
    )?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEventRow {
    pub at: i64,
    pub kind: String,
    pub item_id: Option<i64>,
    pub detail: Option<String>,
}

pub fn recent_events(conn: &Connection, game: GameId, limit: i64) -> AppResult<Vec<CaptureEventRow>> {
    let mut stmt = conn.prepare("SELECT at, kind, item_id, detail FROM loot_capture_events WHERE game = ?1 ORDER BY id DESC LIMIT ?2")?;
    let rows = stmt.query_map(params![game.as_str(), limit.clamp(1, 500)], |r| Ok(CaptureEventRow { at: r.get(0)?, kind: r.get(1)?, item_id: r.get(2)?, detail: r.get(3)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// ---------- export / import ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedItem {
    pub raw_text: String,
    pub captured_at: i64,
    #[serde(default)]
    pub last_captured_at: Option<i64>,
    #[serde(default)]
    pub capture_count: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub origin_status: Option<String>,
    #[serde(default)]
    pub origin_note: Option<String>,
    #[serde(default)]
    pub value_status: Option<String>,
    #[serde(default)]
    pub value_total: Option<f64>,
    #[serde(default)]
    pub valuations: Vec<serde_json::Value>,
}

pub fn export_items(conn: &Connection, game: GameId, ids: &[i64]) -> AppResult<Vec<ExportedItem>> {
    let all = list(conn, game, &LibraryQuery { sort: Some("oldest".into()), limit: Some(20_000), ..Default::default() })?;
    let mut out = Vec::new();
    for it in all.into_iter().filter(|i| ids.is_empty() || ids.contains(&i.id)) {
        let raw = raw_text(conn, game, it.id)?.unwrap_or_default();
        let vals = valuations(conn, it.id)?.into_iter().map(|v| serde_json::to_value(v).unwrap_or_default()).collect();
        out.push(ExportedItem {
            raw_text: raw,
            captured_at: it.captured_at,
            last_captured_at: Some(it.last_captured_at),
            capture_count: Some(it.capture_count),
            notes: it.notes,
            tags: it.tags,
            status: Some(it.status),
            favorite: it.favorite,
            origin_status: Some(it.origin_status),
            origin_note: it.origin_note,
            value_status: Some(it.value_status),
            value_total: it.value_total,
            valuations: vals,
        });
    }
    Ok(out)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub rejected: usize,
}

/// Imports exported items. Each raw text is re-validated as an item copy;
/// an item with the same fingerprint and capture time is skipped. Imported
/// items are re-valued from current market data (their old valuations are
/// kept only in the export file).
pub fn import_items(conn: &Connection, game: GameId, items: &[ExportedItem], now: i64) -> AppResult<ImportResult> {
    let mut r = ImportResult::default();
    for e in items {
        let Some(h) = super::item_text::parse_header(&e.raw_text) else {
            r.rejected += 1;
            continue;
        };
        let fp = super::item_text::fingerprint(&e.raw_text);
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM loot_items WHERE game = ?1 AND fingerprint = ?2 AND captured_at = ?3)",
            params![game.as_str(), fp, e.captured_at],
            |x| x.get(0),
        )?;
        if exists {
            r.skipped_duplicates += 1;
            continue;
        }
        let ctx = CaptureContext { now: e.captured_at.min(now), ..Default::default() };
        let id = match capture(conn, game, &e.raw_text, &h, &fp, &ctx, DuplicateMode::Always, 0, "import")? {
            CaptureOutcome::New(id) => id,
            CaptureOutcome::Merged(_) | CaptureOutcome::Debounced(_) => {
                r.skipped_duplicates += 1;
                continue;
            }
        };
        conn.execute(
            "UPDATE loot_items SET last_captured_at = MAX(captured_at, ?2), capture_count = MAX(1, ?3) WHERE id = ?1",
            params![id, e.last_captured_at.unwrap_or(e.captured_at), e.capture_count.unwrap_or(1)],
        )?;
        edit(
            conn,
            game,
            id,
            &ItemEdit {
                notes: e.notes.clone(),
                tags: Some(e.tags.iter().take(MAX_TAGS).cloned().collect()),
                status: e.status.clone().filter(|s| matches!(s.as_str(), "captured" | "kept" | "sold" | "discarded")),
                favorite: Some(e.favorite),
                origin_status: e.origin_status.clone().filter(|s| matches!(s.as_str(), "unknown" | "user_confirmed_drop" | "user_not_a_drop")),
                origin_note: e.origin_note.clone(),
                ..Default::default()
            },
        )?;
        r.imported += 1;
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::super::item_text::{fingerprint, parse_header, samples};
    use super::*;
    use crate::db::Database;

    fn cap(c: &Connection, raw: &str, now: i64, mode: DuplicateMode) -> CaptureOutcome {
        let h = parse_header(raw).unwrap();
        capture(c, GameId::Poe2, raw, &h, &fingerprint(raw), &CaptureContext { now, ..Default::default() }, mode, 600, "clipboard").unwrap()
    }

    #[test]
    fn duplicates_debounce_merge_cooldown_and_always() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let CaptureOutcome::New(id) = cap(&c, samples::RARE, 1000, DuplicateMode::Merge) else { panic!() };
        assert_eq!(cap(&c, samples::RARE, 1001, DuplicateMode::Merge), CaptureOutcome::Debounced(id), "repeated notification");
        assert_eq!(cap(&c, samples::RARE, 1100, DuplicateMode::Merge), CaptureOutcome::Merged(id));
        let it = get(&c, GameId::Poe2, id).unwrap().unwrap();
        assert_eq!((it.capture_count, it.last_captured_at, it.captured_at), (2, 1100, 1000));
        assert_eq!(cap(&c, samples::RARE, 1200, DuplicateMode::Cooldown), CaptureOutcome::Merged(id), "within cooldown");
        assert!(matches!(cap(&c, samples::RARE, 5000, DuplicateMode::Cooldown), CaptureOutcome::New(n) if n != id), "after cooldown: recapture");
        assert!(matches!(cap(&c, samples::RARE, 6000, DuplicateMode::Always), CaptureOutcome::New(_)));
        // A different roll is a different item even in merge mode.
        assert!(matches!(cap(&c, &samples::RARE.replace("+89", "+90"), 6100, DuplicateMode::Merge), CaptureOutcome::New(_)));
        assert_eq!(list(&c, GameId::Poe2, &LibraryQuery::default()).unwrap().len(), 4);
        assert!(list(&c, GameId::Poe1, &LibraryQuery::default()).unwrap().is_empty(), "game isolation");
        let ev = recent_events(&c, GameId::Poe2, 50).unwrap();
        assert!(ev.iter().any(|e| e.kind == "duplicate"));
    }

    #[test]
    fn valuation_history_is_append_only_on_change() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let CaptureOutcome::New(id) = cap(&c, samples::CURRENCY, 1000, DuplicateMode::Merge) else { panic!() };
        let v = |unit: f64| NewValuation {
            status: "priced",
            unit_value: Some(unit),
            quantity: 3,
            unit: "exalted",
            source: "poe.ninja".into(),
            market_category: Some("currency".into()),
            league: Some("L".into()),
            confidence: Some("high"),
            data_fetched_at: Some(900),
            note: None,
            icon: Some("https://example.invalid/x.png".into()),
        };
        assert!(record_valuation(&c, GameId::Poe2, id, &v(1.0), 1000).unwrap());
        assert!(!record_valuation(&c, GameId::Poe2, id, &v(1.001), 2000).unwrap(), "unchanged within 0.5%");
        assert!(record_valuation(&c, GameId::Poe2, id, &v(1.2), 3000).unwrap());
        let hist = valuations(&c, id).unwrap();
        assert_eq!(hist.iter().map(|h| h.total_value.unwrap()).collect::<Vec<_>>(), vec![3.0, 3.5999999999999996]);
        let it = get(&c, GameId::Poe2, id).unwrap().unwrap();
        assert_eq!((it.value_status.as_str(), it.value_checked_at), ("priced", Some(3000)));
        assert!(it.icon.is_some());
        // Due list: priced items come back after the interval only.
        assert!(due_for_valuation(&c, GameId::Poe2, 3500, 3600, 300, 5, 10).unwrap().is_empty());
        assert_eq!(due_for_valuation(&c, GameId::Poe2, 7000, 3600, 300, 5, 10).unwrap().len(), 1);
        assert!(due_for_valuation(&c, GameId::Poe2, 7000, 0, 300, 5, 10).unwrap().is_empty(), "interval 0 = no revaluation");

        // No market data: fast retries, and after they run out still once per interval
        // (poe.ninja can list the item again later). The retry count restarts on a status change.
        let none = NewValuation { status: "no_market_data", unit_value: None, market_category: None, confidence: None, data_fetched_at: None, ..v(1.0) };
        for t in 0..6 {
            record_valuation(&c, GameId::Poe2, id, &none, 10_000 + t * 300).unwrap();
        }
        let checks: i64 = c.query_row("SELECT value_checks FROM loot_items WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(checks, 6, "counted from the change to no data");
        let last = 10_000 + 5 * 300;
        assert!(due_for_valuation(&c, GameId::Poe2, last + 400, 3600, 300, 5, 10).unwrap().is_empty(), "fast retries used up");
        assert_eq!(due_for_valuation(&c, GameId::Poe2, last + 3600, 3600, 300, 5, 10).unwrap().len(), 1, "rechecked at the interval");
        assert!(due_for_valuation(&c, GameId::Poe2, last + 3600, 0, 300, 5, 10).unwrap().is_empty());
        record_valuation(&c, GameId::Poe2, id, &v(1.2), last + 3600).unwrap();
        let checks: i64 = c.query_row("SELECT value_checks FROM loot_items WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(checks, 1);
    }

    #[test]
    fn switching_league_requeues_market_valuations_only() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let CaptureOutcome::New(a) = cap(&c, samples::CURRENCY, 1000, DuplicateMode::Merge) else { panic!() };
        let CaptureOutcome::New(b) = cap(&c, samples::RARE, 1000, DuplicateMode::Merge) else { panic!() };
        let v = |status: &'static str, league: Option<&str>| NewValuation {
            status,
            unit_value: (status == "priced").then_some(1.0),
            quantity: 1,
            unit: "exalted",
            source: "poe.ninja".into(),
            market_category: None,
            league: league.map(Into::into),
            confidence: None,
            data_fetched_at: None,
            note: None,
            icon: None,
        };
        record_valuation(&c, GameId::Poe2, a, &v("priced", Some("Runes of Aldur")), 1100).unwrap();
        record_valuation(&c, GameId::Poe2, b, &v("unsupported", Some("Runes of Aldur")), 1100).unwrap();
        assert_eq!(requeue_other_league(&c, GameId::Poe2, "Runes of Aldur").unwrap(), 0, "same league");
        assert_eq!(requeue_other_league(&c, GameId::Poe2, "Forbidden Rites").unwrap(), 1, "only the market-valued item");
        assert_eq!(get(&c, GameId::Poe2, a).unwrap().unwrap().value_status, "pending");
        assert_eq!(get(&c, GameId::Poe2, b).unwrap().unwrap().value_status, "unsupported");
    }

    #[test]
    fn search_filters_edits_and_deletes() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        cap(&c, samples::RARE, 1000, DuplicateMode::Merge);
        cap(&c, samples::CURRENCY, 2000, DuplicateMode::Merge);
        cap(&c, samples::WAYSTONE, 3000, DuplicateMode::Merge);
        let q = |search: &str| list(&c, GameId::Poe2, &LibraryQuery { search: Some(search.into()), ..Default::default() }).unwrap().len();
        assert_eq!(q("maximum Life"), 1, "by modifier");
        assert_eq!(q("Exalted"), 1, "by base type");
        assert_eq!(q("Sample Coil"), 1, "by name");
        assert_eq!(q("%zz"), 0, "wildcards escaped");
        assert_eq!(q("20%"), 1, "a literal percent sign matches");
        let cats = list(&c, GameId::Poe2, &LibraryQuery { category: Some("waystone".into()), ..Default::default() }).unwrap();
        assert_eq!(cats.len(), 1);
        let id = cats[0].id;
        edit(&c, GameId::Poe2, id, &ItemEdit { notes: Some("keep for T15".into()), tags: Some(vec!["juice".into()]), status: Some("kept".into()), favorite: Some(true), origin_status: Some("user_confirmed_drop".into()), origin_note: None, ..Default::default() }).unwrap();
        let it = get(&c, GameId::Poe2, id).unwrap().unwrap();
        assert_eq!((it.status.as_str(), it.favorite, it.tags.clone(), it.origin_status.as_str()), ("kept", true, vec!["juice".to_string()], "user_confirmed_drop"));
        assert_eq!(raw_text(&c, GameId::Poe2, id).unwrap().unwrap(), samples::WAYSTONE, "raw text never changes");
        assert!(edit(&c, GameId::Poe2, id, &ItemEdit { status: Some("stolen".into()), ..Default::default() }).is_err());
        assert_eq!(list(&c, GameId::Poe2, &LibraryQuery { favorites_only: Some(true), ..Default::default() }).unwrap().len(), 1);
        assert_eq!(list(&c, GameId::Poe2, &LibraryQuery { sort: Some("oldest".into()), ..Default::default() }).unwrap()[0].captured_at, 1000);
        assert!(list(&c, GameId::Poe2, &LibraryQuery { sort: Some("x".into()), ..Default::default() }).is_err());
        assert_eq!(apply_retention(&c, GameId::Poe2, 1, 3000 + 86_401).unwrap(), 2, "favorites are kept");
        assert_eq!(delete(&c, GameId::Poe2, &[id]).unwrap(), 1);
    }

    #[test]
    fn export_import_round_trip_revalidates_text() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        cap(&c, samples::RARE, 1000, DuplicateMode::Merge);
        let mut exported = export_items(&c, GameId::Poe2, &[]).unwrap();
        clear(&c, GameId::Poe2).unwrap();
        exported.push(ExportedItem { raw_text: "my password".into(), captured_at: 5, last_captured_at: None, capture_count: None, notes: None, tags: vec![], status: None, favorite: false, origin_status: None, origin_note: None, value_status: None, value_total: None, valuations: vec![] });
        let r = import_items(&c, GameId::Poe2, &exported, 9000).unwrap();
        assert_eq!((r.imported, r.rejected), (1, 1));
        let again = import_items(&c, GameId::Poe2, &exported, 9000).unwrap();
        assert_eq!(again.skipped_duplicates, 1);
        let items = list(&c, GameId::Poe2, &LibraryQuery::default()).unwrap();
        assert_eq!((items.len(), items[0].captured_at, items[0].source.as_str()), (1, 1000, "import"));
    }

    #[test]
    fn session_link_is_cleared_when_the_session_is_deleted() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let sid = crate::session::store::create_session(&c, GameId::Poe2, 100, None, None, true, 100).unwrap();
        crate::session::store::finish(&c, sid, 500, "game_closed").unwrap();
        let h = parse_header(samples::RARE).unwrap();
        let ctx = CaptureContext { now: 300, session_id: Some(sid), area_name: Some("Razed Fields".into()), area_kind: Some("map".into()), session_elapsed_secs: Some(200), ..Default::default() };
        let CaptureOutcome::New(id) = capture(&c, GameId::Poe2, samples::RARE, &h, &fingerprint(samples::RARE), &ctx, DuplicateMode::Merge, 0, "clipboard").unwrap() else { panic!() };
        let it = get(&c, GameId::Poe2, id).unwrap().unwrap();
        assert_eq!((it.session_id, it.capture_area_name.as_deref(), it.origin_status.as_str()), (Some(sid), Some("Razed Fields"), "unknown"));
        crate::session::store::delete(&c, GameId::Poe2, &[sid]).unwrap();
        assert_eq!(get(&c, GameId::Poe2, id).unwrap().unwrap().session_id, None);
    }

    #[test]
    fn corrections_verification_and_new_filters() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let CaptureOutcome::New(cur) = cap(&c, samples::CURRENCY, 1000, DuplicateMode::Merge) else { panic!() };
        let CaptureOutcome::New(rare) = cap(&c, samples::RARE, 2000, DuplicateMode::Merge) else { panic!() };
        let raw_before = raw_text(&c, GameId::Poe2, cur).unwrap();
        // Correct quantity and category; the recognised values are kept, the raw copy is untouched.
        edit(&c, GameId::Poe2, cur, &ItemEdit { stack_size: Some(5), category: Some("fragment".into()), ..Default::default() }).unwrap();
        let it = get(&c, GameId::Poe2, cur).unwrap().unwrap();
        assert_eq!((it.stack_size, it.category.as_str(), it.original_stack_size, it.original_category.as_deref()), (Some(5), "fragment", Some(3), Some("currency")));
        edit(&c, GameId::Poe2, cur, &ItemEdit { stack_size: Some(7), ..Default::default() }).unwrap();
        assert_eq!(get(&c, GameId::Poe2, cur).unwrap().unwrap().original_stack_size, Some(3), "first recognised value kept");
        assert_eq!(raw_text(&c, GameId::Poe2, cur).unwrap(), raw_before);
        assert!(edit(&c, GameId::Poe2, cur, &ItemEdit { category: Some("bogus".into()), ..Default::default() }).is_err());
        assert!(edit(&c, GameId::Poe2, cur, &ItemEdit { stack_size: Some(0), ..Default::default() }).is_err());
        assert!(ItemEdit { stack_size: Some(2), ..Default::default() }.needs_revalue());
        assert!(!ItemEdit { verified: Some(true), ..Default::default() }.needs_revalue());
        edit(&c, GameId::Poe2, cur, &ItemEdit { reset_corrections: Some(true), ..Default::default() }).unwrap();
        let it = get(&c, GameId::Poe2, cur).unwrap().unwrap();
        assert_eq!((it.stack_size, it.category.as_str(), it.original_stack_size, it.original_category), (Some(3), "currency", None, None));
        // Setting the recognised value back clears the correction marker too.
        edit(&c, GameId::Poe2, cur, &ItemEdit { stack_size: Some(4), ..Default::default() }).unwrap();
        edit(&c, GameId::Poe2, cur, &ItemEdit { stack_size: Some(3), ..Default::default() }).unwrap();
        assert_eq!(get(&c, GameId::Poe2, cur).unwrap().unwrap().original_stack_size, None);

        // Verification and filters.
        edit(&c, GameId::Poe2, rare, &ItemEdit { verified: Some(true), ..Default::default() }).unwrap();
        let ids = |q: LibraryQuery| list(&c, GameId::Poe2, &q).unwrap().into_iter().map(|i| i.id).collect::<Vec<_>>();
        assert_eq!(ids(LibraryQuery { verified_only: Some(true), ..Default::default() }), vec![rare]);
        assert_eq!(ids(LibraryQuery { unpriced_only: Some(true), ..Default::default() }).len(), 2, "nothing priced yet");
        assert_eq!(ids(LibraryQuery { sort: Some("quantity".into()), ..Default::default() }), vec![cur, rare]);
        // Latest valuation details and the value at capture time.
        let v = |unit: f64, at: i64| NewValuation {
            status: "priced",
            unit_value: Some(unit),
            quantity: 3,
            unit: "exalted",
            source: "poe.ninja".into(),
            market_category: Some("currency".into()),
            league: Some("Rise".into()),
            confidence: Some("high"),
            data_fetched_at: Some(at - 10),
            note: None,
            icon: None,
        };
        record_valuation(&c, GameId::Poe2, cur, &v(1.0, 1500), 1500).unwrap();
        record_valuation(&c, GameId::Poe2, cur, &v(2.0, 2500), 2500).unwrap();
        let it = get(&c, GameId::Poe2, cur).unwrap().unwrap();
        assert_eq!((it.value_total, it.value_at_capture), (Some(6.0), Some(3.0)), "market changes never overwrite the value at capture");
        assert_eq!((it.value_source.as_deref(), it.value_confidence.as_deref(), it.value_fetched_at, it.value_league.as_deref()), (Some("poe.ninja"), Some("high"), Some(2490), Some("Rise")));
        assert_eq!(ids(LibraryQuery { unpriced_only: Some(true), ..Default::default() }), vec![rare]);
    }
}
