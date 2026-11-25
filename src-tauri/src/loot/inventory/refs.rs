//! Reference item art for icon recognition.
//!
//! The URLs come from the cached poe.ninja PoE 2 exchange data of the selected league (currency, essences,
//! runes, omens, …): official images on `web.poecdn.com`. They are downloaded once into
//! `<data dir>/icon-cache/poe2/` (with the user's consent, 2026-11-24), used only for comparison and never
//! bundled with Vaalytics. Downloads are sequential and spaced; already cached files are never re-fetched.

use super::icons::Reference;
use super::image::Rgba;
use crate::db::Database;
use crate::game::GameId;
use rusqlite::params;
use std::path::{Path, PathBuf};
use std::time::Duration;

const HOST: &str = "https://web.poecdn.com/";
const SPACING: Duration = Duration::from_millis(60);
const MAX_ICON_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub name: String,
    pub category: String,
    pub url: String,
}

/// Stackable PoE 2 items with art in the market cache for `league` (unique items excluded).
pub fn sources(db: &Database, league: &str) -> crate::error::AppResult<Vec<Source>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT name, category, MAX(icon) FROM market_items
         WHERE game = ?1 AND league = ?2 AND variant IS NULL AND icon IS NOT NULL AND category NOT LIKE 'unique-%'
         GROUP BY name ORDER BY name",
    )?;
    let rows = stmt.query_map(params![GameId::Poe2.as_str(), league], |r| Ok(Source { name: r.get(0)?, category: r.get(1)?, url: r.get(2)? }))?;
    Ok(rows.filter_map(Result::ok).filter(|s| s.url.starts_with(HOST)).collect())
}

/// The market art URL of an item (for showing it), if listed in `league`.
pub fn icon_for(db: &Database, league: &str, name: &str) -> Option<String> {
    db.conn()
        .ok()?
        .query_row(
            "SELECT icon FROM market_items WHERE game = ?1 AND league = ?2 AND name = ?3 AND variant IS NULL AND icon IS NOT NULL LIMIT 1",
            params![GameId::Poe2.as_str(), league, name],
            |r| r.get(0),
        )
        .ok()
}

/// Cache file of a URL (FNV-1a of the URL; the CDN path already embeds a content hash).
pub fn cache_file(dir: &Path, url: &str) -> PathBuf {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in url.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    dir.join(format!("{h:016x}.png"))
}

/// Downloads the art that isn't cached yet. Returns (downloaded, failed).
pub fn fetch_missing(dir: &Path, sources: &[Source], progress: &dyn Fn(usize, usize)) -> (usize, usize) {
    let mut urls: Vec<&str> = sources.iter().map(|s| s.url.as_str()).filter(|u| !cache_file(dir, u).is_file()).collect();
    urls.sort_unstable();
    urls.dedup();
    if urls.is_empty() {
        return (0, 0);
    }
    if std::fs::create_dir_all(dir).is_err() {
        return (0, urls.len());
    }
    let client = match reqwest::Client::builder()
        .user_agent(concat!("Vaalytics/", env!("CARGO_PKG_VERSION"), " (Windows desktop companion for Path of Exile)"))
        .timeout(Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (0, urls.len()),
    };
    let total = urls.len();
    tauri::async_runtime::block_on(async move {
        let (mut ok, mut failed) = (0, 0);
        for (i, url) in urls.into_iter().enumerate() {
            progress(i, total);
            let got = async {
                let r = client.get(url).send().await.ok()?;
                if !r.status().is_success() {
                    return None;
                }
                let b = r.bytes().await.ok()?;
                (b.len() <= MAX_ICON_BYTES && Rgba::from_png(&b).is_ok()).then_some(b)
            }
            .await;
            match got {
                Some(bytes) => {
                    let path = cache_file(dir, url);
                    let tmp = path.with_extension("part");
                    if std::fs::write(&tmp, &bytes).and_then(|_| std::fs::rename(&tmp, &path)).is_ok() {
                        ok += 1;
                    } else {
                        failed += 1;
                    }
                }
                None => failed += 1,
            }
            tokio::time::sleep(SPACING).await;
        }
        (ok, failed)
    })
}

/// References for every source whose art is cached (missing art is skipped).
pub fn load(dir: &Path, sources: &[Source]) -> Vec<Reference> {
    let mut cache: std::collections::HashMap<&str, Option<Rgba>> = std::collections::HashMap::new();
    let mut out = Vec::new();
    for s in sources {
        let img = cache.entry(s.url.as_str()).or_insert_with(|| std::fs::read(cache_file(dir, &s.url)).ok().and_then(|b| Rgba::from_png(&b).ok()));
        if let Some(img) = img {
            if let Some(r) = Reference::new(&s.name, &s.category, img) {
                out.push(r);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_official_cdn_art_from_the_selected_league() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let ins = |league: &str, cat: &str, name: &str, icon: &str| {
            c.execute(
                "INSERT INTO market_items (game, league, category, item_id, name, icon, value, updated_at) VALUES ('poe2', ?1, ?2, ?3, ?3, ?4, 1, 0)",
                params![league, cat, name, icon],
            )
            .unwrap();
        };
        ins("Rise", "currency", "Exalted Orb", "https://web.poecdn.com/gen/image/a/Exalt.png");
        ins("Rise", "currency", "Greater Exalted Orb", "https://web.poecdn.com/gen/image/a/Exalt.png");
        ins("Rise", "unique-jewels", "Prism", "https://web.poecdn.com/gen/image/b/Prism.png");
        ins("Rise", "currency", "Elsewhere", "https://example.com/x.png");
        ins("Other", "currency", "Divine Orb", "https://web.poecdn.com/gen/image/c/Divine.png");
        drop(c);
        let s = sources(&db, "Rise").unwrap();
        assert_eq!(s.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Exalted Orb", "Greater Exalted Orb"]);
        let dir = std::path::Path::new("x");
        assert_eq!(cache_file(dir, &s[0].url), cache_file(dir, &s[1].url), "shared art is cached once");
    }
}
