//! Inventory snapshots inside the Loot Journal service: one screenshot per deliberate action (the
//! user's shortcut, or a PNG they pick), recognition on a worker thread, results stored for review.

use super::super::{maps, tracker_window, valuation, LootService, GAME};
use super::{capture, grid, image::Rgba, recognize, refs, snapshots};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// Progress and results (`loot:inventory`).
pub const EVENT_INVENTORY: &str = "loot:inventory";

#[derive(Default)]
pub struct InventoryState {
    busy: AtomicBool,
    data_dir: Mutex<Option<PathBuf>>,
    /// References for one league (rebuilt when the league or the cached art changes).
    refs: Mutex<Option<(String, usize, Arc<Vec<super::icons::Reference>>)>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEvent {
    /// working | captured | error
    pub kind: &'static str,
    pub message: String,
    pub snapshot_id: Option<i64>,
    pub cells: Option<i64>,
    pub to_review: Option<i64>,
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDetail {
    pub snapshot: snapshots::Snapshot,
    pub entries: Vec<snapshots::Entry>,
    /// The stored inventory crop as a data URL (None if the file is gone).
    pub image: Option<String>,
    /// Grid in the crop's pixels.
    pub grid: Option<serde_json::Value>,
    pub delta: snapshots::Delta,
}

impl LootService {
    fn inv(&self) -> &InventoryState {
        &self.inner.inventory
    }

    pub fn set_data_dir(&self, dir: PathBuf) {
        if let Ok(mut d) = self.inv().data_dir.lock() {
            *d = Some(dir);
        }
    }

    fn data_dir(&self) -> AppResult<PathBuf> {
        self.inv().data_dir.lock().ok().and_then(|d| d.clone()).ok_or_else(|| AppError::InvalidInput("Storage isn't ready yet.".into()))
    }

    fn emit_inventory(&self, e: InventoryEvent) {
        if let Some(app) = self.inner.app.get() {
            let _ = app.emit(EVENT_INVENTORY, &e);
        }
    }

    fn working(&self, message: impl Into<String>) {
        self.emit_inventory(InventoryEvent { kind: "working", message: message.into(), snapshot_id: None, cells: None, to_review: None });
    }

    /// Reference art for the selected league, downloading what isn't cached yet.
    fn references(&self) -> AppResult<(String, Arc<Vec<super::icons::Reference>>)> {
        let league = valuation::league_for(&self.inner.db, GAME).ok_or_else(|| AppError::InvalidInput("No market league yet — open Currency Tracker once so Vaalytics knows the item art to compare with.".into()))?;
        let sources = refs::sources(&self.inner.db, &league)?;
        if sources.is_empty() {
            return Err(AppError::InvalidInput(format!("No market data cached for {league} yet — open Currency Tracker once, then try again.")));
        }
        let dir = self.data_dir()?.join("icon-cache").join("poe2");
        let me = self.clone();
        let (got, failed) = refs::fetch_missing(&dir, &sources, &move |i, n| {
            if i % 25 == 0 {
                me.working(format!("Preparing item art for recognition ({i}/{n}, first time only)…"));
            }
        });
        if got > 0 || failed > 0 {
            log::info!("loot inventory: item art cached {got}, failed {failed}");
        }
        if let Ok(cache) = self.inv().refs.lock() {
            if let Some((l, n, r)) = cache.as_ref() {
                if *l == league && *n == sources.len() && got == 0 {
                    return Ok((league, Arc::clone(r)));
                }
            }
        }
        let loaded = Arc::new(refs::load(&dir, &sources));
        if loaded.is_empty() {
            return Err(AppError::InvalidInput("Item art for recognition couldn't be downloaded. Check your connection and try again.".into()));
        }
        if let Ok(mut cache) = self.inv().refs.lock() {
            *cache = Some((league.clone(), sources.len(), Arc::clone(&loaded)));
        }
        Ok((league, loaded))
    }

    /// The shortcut was pressed: one screenshot of the game window, then recognition. Runs off the main thread.
    pub fn capture_inventory_hotkey(&self) {
        let r = (|| -> AppResult<i64> {
            let img = self.grab_game_window()?;
            self.process_screenshot(img, "hotkey")
        })();
        if let Err(e) = r {
            self.emit_inventory(InventoryEvent { kind: "error", message: e.to_string(), snapshot_id: None, cells: None, to_review: None });
        }
    }

    /// A PNG screenshot the user picked (same recognition, source "file").
    pub fn capture_inventory_file(&self, png: &[u8]) -> AppResult<i64> {
        let img = Rgba::from_png(png).map_err(|_| AppError::InvalidInput("That file isn't a PNG screenshot.".into()))?;
        let r = self.process_screenshot(img, "file");
        if let Err(e) = &r {
            self.emit_inventory(InventoryEvent { kind: "error", message: e.to_string(), snapshot_id: None, cells: None, to_review: None });
        }
        r
    }

    /// Hides the Loot Tracker for the moment of the capture so it can't cover the inventory.
    fn grab_game_window(&self) -> AppResult<Rgba> {
        let app = self.inner.app.get().cloned();
        let shown = app.as_ref().is_some_and(|a| tracker_window::state(a).visible);
        if let (true, Some(a)) = (shown, &app) {
            let h = a.clone();
            let _ = a.run_on_main_thread(move || {
                let _ = tracker_window::hide(&h);
            });
            std::thread::sleep(Duration::from_millis(180));
        }
        let shot = capture::game_window();
        if let (true, Some(a)) = (shown, &app) {
            let h = a.clone();
            let _ = a.run_on_main_thread(move || {
                let _ = tracker_window::open(&h);
            });
        }
        shot.map_err(AppError::InvalidInput)
    }

    fn process_screenshot(&self, img: Rgba, source: &'static str) -> AppResult<i64> {
        if self.inv().busy.swap(true, Ordering::SeqCst) {
            return Err(AppError::InvalidInput("A screenshot is already being processed.".into()));
        }
        let _busy = Busy(&self.inv().busy);
        let now = (self.inner.now)();
        // Validate before anything is stored: no inventory grid → nothing is saved.
        let g = grid::locate(&img).map_err(AppError::InvalidInput)?;
        self.working("Recognising the inventory…");
        let (league, refs) = self.references()?;
        let cells = {
            let mut out = Vec::new();
            for row in 0..grid::ROWS {
                for col in 0..grid::COLS {
                    let (x, y, s) = g.cell_rect(col, row, 0.0);
                    if let Some(c) = recognize::cell(&refs, &img.crop(x, y, s, s), col, row) {
                        out.push(c);
                    }
                }
            }
            out
        };
        // Keep only the inventory area (with a margin), not the whole screen.
        let (bx, by, bw, bh) = g.bounds(0.15);
        let crop = img.crop(bx, by, bw, bh);
        let rel = grid::Grid { left: g.left - bx as f32, top: g.top - by as f32, ..g };
        let dir = self.data_dir()?.join("loot-snapshots");
        std::fs::create_dir_all(&dir)?;
        let file = format!("{now}-{}.png", std::process::id() as u64 ^ (cells.len() as u64) << 20 ^ (now as u64 & 0xfffff));
        std::fs::write(dir.join(&file), crop.to_png().map_err(AppError::InvalidInput)?)?;
        let ctx = (self.inner.session)();
        let id = {
            let mut c = self.inner.db.conn()?;
            let tx = c.transaction()?;
            let map = maps::open_run(&tx, GAME, now)?.map(|m| m.id);
            let id = snapshots::insert(
                &tx,
                GAME,
                &snapshots::NewSnapshot {
                    taken_at: now,
                    source,
                    session_id: ctx.as_ref().map(|s| s.session_id),
                    map_run_id: map,
                    screen_w: img.w,
                    screen_h: img.h,
                    grid: &rel,
                    image_file: Some(file),
                    league: Some(league),
                    cells: &cells,
                },
            )?;
            tx.commit()?;
            id
        };
        let s = snapshots::get(&*self.inner.db.conn()?, GAME, id)?;
        let (n, review) = s.map(|s| (s.cells, s.to_review)).unwrap_or((0, 0));
        log::info!("loot inventory: snapshot {id} from {source}: {n} cells, {review} to review");
        self.emit_inventory(InventoryEvent {
            kind: "captured",
            message: format!("Inventory captured: {n} item{} recognised{}.", if n == 1 { "" } else { "s" }, if review > 0 { format!(", {review} to check in Loot Journal") } else { String::new() }),
            snapshot_id: Some(id),
            cells: Some(n),
            to_review: Some(review),
        });
        self.emit_updated();
        Ok(id)
    }

    /// Recognises the stored crop again (after better item art or a newer recognizer); corrections stay.
    pub fn reprocess_snapshot(&self, id: i64) -> AppResult<()> {
        let snap = snapshots::get(&*self.inner.db.conn()?, GAME, id)?.ok_or_else(|| AppError::InvalidInput("Snapshot not found.".into()))?;
        let file = snap.image_file.clone().ok_or_else(|| AppError::InvalidInput("The screenshot of this snapshot is gone.".into()))?;
        let png = std::fs::read(self.data_dir()?.join("loot-snapshots").join(&file)).map_err(|_| AppError::InvalidInput("The screenshot of this snapshot is gone.".into()))?;
        let img = Rgba::from_png(&png).map_err(AppError::InvalidInput)?;
        let g = self.stored_grid(id)?;
        let (_, refs) = self.references()?;
        let mut cells = Vec::new();
        for row in 0..grid::ROWS {
            for col in 0..grid::COLS {
                let (x, y, s) = g.cell_rect(col, row, 0.0);
                if let Some(c) = recognize::cell(&refs, &img.crop(x, y, s, s), col, row) {
                    cells.push(c);
                }
            }
        }
        let mut c = self.inner.db.conn()?;
        let tx = c.transaction()?;
        snapshots::replace_recognition(&tx, GAME, id, &cells)?;
        tx.commit()?;
        drop(c);
        self.emit_updated();
        Ok(())
    }

    fn stored_grid(&self, id: i64) -> AppResult<grid::Grid> {
        let json: String = self.inner.db.conn()?.query_row("SELECT grid FROM loot_inventory_snapshots WHERE game = ?1 AND id = ?2", rusqlite::params![GAME.as_str(), id], |r| r.get(0))?;
        let v: serde_json::Value = serde_json::from_str(&json)?;
        let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).map(|x| x as f32).ok_or_else(|| AppError::InvalidInput("Stored grid is unreadable.".into()));
        Ok(grid::Grid { left: f("left")?, top: f("top")?, cell: f("cell")?, score: f("score").unwrap_or(0.0) })
    }

    /// Change against `against` (default: the latest confirmed snapshot before it). Prices are looked up
    /// before the comparison runs, so no database lock is held while pricing.
    pub fn snapshot_delta(&self, id: i64, against: Option<i64>) -> AppResult<snapshots::Delta> {
        let (league, against, names) = {
            let c = self.inner.db.conn()?;
            let snap = snapshots::get(&c, GAME, id)?.ok_or_else(|| AppError::InvalidInput("Snapshot not found.".into()))?;
            let against = match against {
                Some(a) => Some(a),
                None => snapshots::previous_confirmed(&c, GAME, id)?,
            };
            let mut names: Vec<String> = snapshots::entries(&c, GAME, id)?.into_iter().filter_map(|e| e.name).collect();
            if let Some(a) = against {
                names.extend(snapshots::entries(&c, GAME, a)?.into_iter().filter_map(|e| e.name));
            }
            names.sort();
            names.dedup();
            (snap.league, against, names)
        };
        let league = league.or_else(|| valuation::league_for(&self.inner.db, GAME));
        let prices: std::collections::HashMap<String, f64> = match &league {
            Some(l) => names
                .into_iter()
                .filter_map(|n| crate::market::store::find_by_name(&self.inner.db, GAME, l, &n).ok().flatten().map(|m| (n, m.value)))
                .collect(),
            None => Default::default(),
        };
        let c = self.inner.db.conn()?;
        snapshots::delta(&c, GAME, id, against, &|n: &str| prices.get(n).copied())
    }

    pub fn snapshot_detail(&self, id: i64, against: Option<i64>) -> AppResult<Option<SnapshotDetail>> {
        let (snap, entries, grid) = {
            let c = self.inner.db.conn()?;
            let Some(snap) = snapshots::get(&c, GAME, id)? else { return Ok(None) };
            let entries = snapshots::entries(&c, GAME, id)?;
            let grid: Option<String> = c.query_row("SELECT grid FROM loot_inventory_snapshots WHERE id = ?1", [id], |r| r.get(0)).ok();
            (snap, entries, grid.and_then(|g| serde_json::from_str(&g).ok()))
        };
        let image = snap
            .image_file
            .as_ref()
            .and_then(|f| self.data_dir().ok().map(|d| d.join("loot-snapshots").join(f)))
            .and_then(|p| std::fs::read(p).ok())
            .map(|b| format!("data:image/png;base64,{}", base64(&b)));
        let delta = self.snapshot_delta(id, against)?;
        Ok(Some(SnapshotDetail { snapshot: snap, entries, image, grid, delta }))
    }

    pub fn delete_snapshot(&self, id: i64) -> AppResult<()> {
        let file = snapshots::delete(&*self.inner.db.conn()?, GAME, id)?;
        if let (Some(f), Ok(dir)) = (file, self.data_dir()) {
            let _ = std::fs::remove_file(dir.join("loot-snapshots").join(f));
        }
        self.emit_updated();
        Ok(())
    }

    /// Item names the user can pick when correcting a cell (stackables of the selected league).
    pub fn inventory_item_names(&self) -> AppResult<Vec<(String, String)>> {
        let Some(league) = valuation::league_for(&self.inner.db, GAME) else { return Ok(Vec::new()) };
        Ok(refs::sources(&self.inner.db, &league)?.into_iter().map(|s| (s.name, s.category)).collect())
    }
}

#[cfg(test)]
mod tests {
    /// Manual QA: runs the whole pipeline on the fixture against a copy of a real data folder.
    /// LOOT_QA_DIR = data folder with vaalytics.db (a COPY), LOOT_ICON_DIR = downloaded art + list2.tsv.
    #[test]
    #[ignore]
    fn qa_pipeline_on_a_data_copy() {
        use super::super::super::LootService;
        use std::sync::Arc;
        let dir = std::path::PathBuf::from(std::env::var("LOOT_QA_DIR").expect("LOOT_QA_DIR"));
        let icons = std::path::PathBuf::from(std::env::var("LOOT_ICON_DIR").expect("LOOT_ICON_DIR"));
        let cache = dir.join("icon-cache").join("poe2");
        std::fs::create_dir_all(&cache).unwrap();
        for line in std::fs::read_to_string(icons.join("list2.tsv")).unwrap().lines() {
            let f: Vec<&str> = line.split('\t').collect();
            let target = super::refs::cache_file(&cache, f[3]);
            if !target.exists() {
                let _ = std::fs::copy(icons.join(format!("{}.png", f[0])), target);
            }
        }
        let db = Arc::new(crate::db::Database::open(&dir.join("vaalytics.db")).unwrap());
        let svc = LootService::new(db, None, Box::new(|| None), crate::market::http::unix_now);
        svc.set_data_dir(dir.clone());
        let img = super::super::image::load_fixture("poe2-2560x1440-scaled-2000.webp");
        let id = svc.capture_inventory_file(&img.to_png().unwrap()).unwrap();
        let d = svc.snapshot_detail(id, None).unwrap().unwrap();
        println!("snapshot {id}: {} cells, {} to review, image {}", d.snapshot.cells, d.snapshot.to_review, d.image.is_some());
        for l in &d.delta.lines {
            println!("{} {} {:?}", l.name, l.change, l.value);
        }
    }

    #[test]
    fn base64_matches_the_standard_alphabet() {
        assert_eq!(super::base64(b""), "");
        assert_eq!(super::base64(b"f"), "Zg==");
        assert_eq!(super::base64(b"fo"), "Zm8=");
        assert_eq!(super::base64(b"foobar"), "Zm9vYmFy");
    }
}
