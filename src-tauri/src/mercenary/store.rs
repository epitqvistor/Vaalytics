//! SQLite persistence for Mercenary Intelligence (migration 0016). League is part of every
//! query; game is always 'poe1'.

use super::model::*;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use rusqlite::{params, OptionalExtension};
use std::collections::HashMap;

const SOURCE: &str = "trade-api";
const KEEP_SNAPSHOTS_PER_QUERY: i64 = 30;

pub fn save_snapshot(db: &Database, req: &SearchRequest, o: &SearchOutcome) -> AppResult<i64> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO mercenary_snapshots (game, league, platform, source, game_version, catalog_version, query_hash, query_json,
            level, label, status, search_id, total, fetched, complexity, trade_url, rates_json, created_at)
         VALUES ('poe1', ?1, 'pc', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ok', ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            o.league,
            SOURCE,
            req.game_version,
            req.catalog_version,
            o.query_hash,
            serde_json::to_string(&req.query)?,
            req.level,
            req.label,
            o.search_id,
            o.total.map(|t| t as i64),
            o.listings.len() as i64,
            o.complexity.map(|c| c as i64),
            o.trade_url,
            serde_json::to_string(&o.rates)?,
            o.fetched_at
        ],
    )?;
    let id = tx.last_insert_rowid();
    for l in &o.listings {
        tx.execute(
            "INSERT INTO mercenary_observations (snapshot_id, game, league, listing_id, amount, currency, price_type, amount_chaos,
                indexed_at, instant_buyout, build, level, skills_json)
             VALUES (?1, 'poe1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![id, o.league, l.id, l.amount, l.currency, l.price_type, l.amount_chaos, l.indexed, l.instant_buyout, l.build, l.level, serde_json::to_string(&l.skills)?],
        )?;
    }
    // Bounded history per query (observations cascade).
    tx.execute(
        "DELETE FROM mercenary_snapshots WHERE game = 'poe1' AND league = ?1 AND query_hash = ?2 AND id NOT IN
           (SELECT id FROM mercenary_snapshots WHERE game = 'poe1' AND league = ?1 AND query_hash = ?2 ORDER BY created_at DESC, id DESC LIMIT ?3)",
        params![o.league, o.query_hash, KEEP_SNAPSHOTS_PER_QUERY],
    )?;
    tx.commit()?;
    Ok(id)
}

pub fn save_failed_snapshot(db: &Database, league: &str, req: &SearchRequest, hash: &str, error: &str, now: i64) -> AppResult<()> {
    db.conn()?.execute(
        "INSERT INTO mercenary_snapshots (game, league, platform, source, game_version, catalog_version, query_hash, query_json,
            level, label, status, error, created_at)
         VALUES ('poe1', ?1, 'pc', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'error', ?9, ?10)",
        params![league, SOURCE, req.game_version, req.catalog_version, hash, serde_json::to_string(&req.query)?, req.level, req.label, error, now],
    )?;
    Ok(())
}

pub fn latest_ok_snapshot(db: &Database, league: &str, hash: &str) -> AppResult<Option<SearchOutcome>> {
    let conn = db.conn()?;
    let row = conn
        .query_row(
            "SELECT id, level, label, search_id, total, complexity, trade_url, rates_json, created_at, game_version, catalog_version
             FROM mercenary_snapshots WHERE game = 'poe1' AND league = ?1 AND query_hash = ?2 AND status = 'ok'
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![league, hash],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, u8>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?;
    let Some((id, level, label, search_id, total, complexity, trade_url, rates, created_at, game_version, catalog_version)) = row else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT listing_id, amount, currency, price_type, amount_chaos, indexed_at, instant_buyout, build, level, skills_json
         FROM mercenary_observations WHERE snapshot_id = ?1 ORDER BY id",
    )?;
    let listings = stmt
        .query_map(params![id], |r| {
            let skills: String = r.get(9)?;
            Ok(MercListing {
                id: r.get(0)?,
                amount: r.get(1)?,
                currency: r.get(2)?,
                price_type: r.get(3)?,
                amount_chaos: r.get(4)?,
                indexed: r.get(5)?,
                instant_buyout: r.get(6)?,
                build: r.get(7)?,
                level: r.get(8)?,
                skills: serde_json::from_str(&skills).unwrap_or_default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let rates: HashMap<String, f64> = rates.as_deref().and_then(|r| serde_json::from_str(r).ok()).unwrap_or_default();
    Ok(Some(SearchOutcome {
        snapshot_id: Some(id),
        status: "ok",
        error: None,
        league: league.to_owned(),
        query_hash: hash.to_owned(),
        level,
        label,
        search_id,
        total: total.map(|t| t as u64),
        complexity: complexity.map(|c| c as u64),
        trade_url,
        fetched_at: created_at,
        cached: true,
        stale: false,
        skipped_listings: 0,
        rates_available: rates.len() > 1,
        rates,
        listings,
        game_version,
        catalog_version,
    }))
}

pub fn snapshots(db: &Database, league: &str, limit: usize) -> AppResult<Vec<SnapshotSummary>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, level, label, status, error, total, fetched, trade_url, created_at, catalog_version, game_version
         FROM mercenary_snapshots WHERE game = 'poe1' AND league = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![league, limit.clamp(1, 500) as i64], |r| {
            Ok(SnapshotSummary {
                id: r.get(0)?,
                league: league.to_owned(),
                level: r.get(1)?,
                label: r.get(2)?,
                status: r.get(3)?,
                error: r.get(4)?,
                total: r.get(5)?,
                fetched: r.get(6)?,
                trade_url: r.get(7)?,
                created_at: r.get(8)?,
                catalog_version: r.get(9)?,
                game_version: r.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn check_record(r: &ValuationRecord) -> AppResult<()> {
    let ok = |s: &str, max: usize| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control);
    if !ok(&r.fingerprint, 2048) || !ok(&r.family, 64) || !ok(&r.title, 200) || !ok(&r.category, 32) || !ok(&r.confidence, 32) || !ok(&r.rules_version, 32) {
        return Err(AppError::InvalidInput("invalid valuation record".into()));
    }
    if serde_json::to_vec(&r.summary)?.len() > 256 * 1024 {
        return Err(AppError::InvalidInput("valuation summary too large".into()));
    }
    Ok(())
}

pub fn save_valuation(db: &Database, league: &str, r: &ValuationRecord, now: i64) -> AppResult<i64> {
    check_record(r)?;
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO mercenary_valuations (game, league, platform, game_version, catalog_version, rules_version, fingerprint, family, title,
            category, confidence, level, count, p25_chaos, median_chaos, p75_chaos, divine_rate, summary_json, created_at)
         VALUES ('poe1', ?1, 'pc', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            league,
            r.game_version,
            r.catalog_version,
            r.rules_version,
            r.fingerprint,
            r.family,
            r.title,
            r.category,
            r.confidence,
            r.level,
            r.count,
            r.p25_chaos,
            r.median_chaos,
            r.p75_chaos,
            r.divine_rate,
            serde_json::to_string(&r.summary)?,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn valuations(db: &Database, league: &str, fingerprint: Option<&str>, limit: usize) -> AppResult<Vec<ValuationRow>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, created_at, game_version, catalog_version, rules_version, fingerprint, family, title, category, confidence, level, count,
                p25_chaos, median_chaos, p75_chaos, divine_rate, summary_json
         FROM mercenary_valuations WHERE game = 'poe1' AND league = ?1 AND (?2 IS NULL OR fingerprint = ?2)
         ORDER BY created_at DESC, id DESC LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![league, fingerprint, limit.clamp(1, 500) as i64], |r| {
            let summary: String = r.get(16)?;
            Ok(ValuationRow {
                id: r.get(0)?,
                league: league.to_owned(),
                created_at: r.get(1)?,
                record: ValuationRecord {
                    game_version: r.get(2)?,
                    catalog_version: r.get(3)?,
                    rules_version: r.get(4)?,
                    fingerprint: r.get(5)?,
                    family: r.get(6)?,
                    title: r.get(7)?,
                    category: r.get(8)?,
                    confidence: r.get(9)?,
                    level: r.get(10)?,
                    count: r.get(11)?,
                    p25_chaos: r.get(12)?,
                    median_chaos: r.get(13)?,
                    p75_chaos: r.get(14)?,
                    divine_rate: r.get(15)?,
                    summary: serde_json::from_str(&summary).unwrap_or(serde_json::Value::Null),
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete_valuation(db: &Database, id: i64) -> AppResult<()> {
    db.conn()?.execute("DELETE FROM mercenary_valuations WHERE id = ?1 AND game = 'poe1'", params![id])?;
    Ok(())
}

/// Stages a candidate. A candidate that was already reviewed (promoted / rejected) keeps its
/// status; only its evidence is refreshed, so nothing silently changes an active decision.
pub fn stage_candidate(db: &Database, league: &str, c: &RuleCandidate, now: i64) -> AppResult<i64> {
    if c.rule_key.is_empty() || c.rule_key.len() > 200 || c.title.len() > 300 || serde_json::to_vec(&c.evidence)?.len() > 64 * 1024 {
        return Err(AppError::InvalidInput("invalid rule candidate".into()));
    }
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO mercenary_rule_candidates (game, league, game_version, catalog_version, rule_key, family, title, status, evidence_json,
            with_count, without_count, created_at)
         VALUES ('poe1', ?1, ?2, ?3, ?4, ?5, ?6, 'staged', ?7, ?8, ?9, ?10)
         ON CONFLICT (game, league, rule_key) DO UPDATE SET evidence_json = excluded.evidence_json, with_count = excluded.with_count,
            without_count = excluded.without_count, title = excluded.title, catalog_version = excluded.catalog_version",
        params![league, c.game_version, c.catalog_version, c.rule_key, c.family, c.title, serde_json::to_string(&c.evidence)?, c.with_count, c.without_count, now],
    )?;
    Ok(conn.query_row(
        "SELECT id FROM mercenary_rule_candidates WHERE game = 'poe1' AND league = ?1 AND rule_key = ?2",
        params![league, c.rule_key],
        |r| r.get(0),
    )?)
}

pub fn review_candidate(db: &Database, id: i64, status: &str, now: i64) -> AppResult<()> {
    if !matches!(status, "staged" | "validated" | "promoted" | "rejected") {
        return Err(AppError::InvalidInput("invalid rule status".into()));
    }
    let n = db.conn()?.execute(
        "UPDATE mercenary_rule_candidates SET status = ?1, reviewed_at = ?2 WHERE id = ?3 AND game = 'poe1'",
        params![status, now, id],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("rule candidate not found".into()));
    }
    Ok(())
}

pub fn candidates(db: &Database, league: &str) -> AppResult<Vec<RuleCandidateRow>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, status, created_at, reviewed_at, game_version, catalog_version, rule_key, family, title, evidence_json, with_count, without_count
         FROM mercenary_rule_candidates WHERE game = 'poe1' AND league = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt
        .query_map(params![league], |r| {
            let ev: String = r.get(9)?;
            Ok(RuleCandidateRow {
                id: r.get(0)?,
                league: league.to_owned(),
                status: r.get(1)?,
                created_at: r.get(2)?,
                reviewed_at: r.get(3)?,
                candidate: RuleCandidate {
                    game_version: r.get(4)?,
                    catalog_version: r.get(5)?,
                    rule_key: r.get(6)?,
                    family: r.get(7)?,
                    title: r.get(8)?,
                    evidence: serde_json::from_str(&ev).unwrap_or(serde_json::Value::Null),
                    with_count: r.get(10)?,
                    without_count: r.get(11)?,
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
