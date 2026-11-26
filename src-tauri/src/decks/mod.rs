//! Deck Intelligence (PoE 1): Stacked Deck opening sessions.
//! Spec: docs/modules/deck-intelligence.md
//!
//! Two ways a card reaches a session, both optional:
//! - **Client.txt** — the game writes `Card drawn from the deck: <divination>{Name}` (verified on a
//!   real log). Read with the shared incremental reader (`session::reader`) only while a session is
//!   running; the thread sleeps on a condition variable otherwise (no polling while idle).
//! - **Ground screenshot** — the user's own hotkey (registered only while PoE 1 is in the foreground)
//!   takes ONE screenshot of the game window, Windows' built-in OCR reads the labels, names are matched
//!   against the card database. Nothing is captured without a key press.
//!
//! Read-only towards the game: no memory reading, injection, input or file changes.

pub mod cards;
pub mod logparse;
pub mod matching;
pub mod ocr;
pub mod recognize;
pub mod store;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::loot::inventory::image::Rgba;
use crate::settings;
use matching::{Matcher, Thresholds, Verdict};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const GAME: GameId = GameId::Poe1;
pub const EVENT_UPDATED: &str = "decks:updated";
pub const EVENT_DETECTED: &str = "decks:detected";
pub const EVENT_IMPORT: &str = "decks:import";
const CONFIG_KEY: &str = "decks.config";
const LOG_INTERVAL: Duration = Duration::from_secs(2);
const LOG_CHUNK: usize = 1024 * 1024;
const HOTKEY_DEBOUNCE: Duration = Duration::from_millis(400);
const MARKET_CATEGORY: &str = "divination";

fn now() -> i64 {
    crate::market::http::unix_now()
}

// ---------- configuration ----------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Default for Region {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }
    }
}

impl Region {
    /// Fractions clamped to the window; at least 10 % each way.
    pub fn sanitized(self) -> Self {
        let f = |v: f64| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
        let (x, y) = (f(self.x).min(0.9), f(self.y).min(0.9));
        let w = f(self.w).max(0.1).min(1.0 - x);
        let h = f(self.h).max(0.1).min(1.0 - y);
        Self { x, y, w, h }
    }
    pub fn crop(&self, img: &Rgba) -> Rgba {
        let r = self.sanitized();
        let (x, y) = ((r.x * img.w as f64) as usize, (r.y * img.h as f64) as usize);
        let (w, h) = ((r.w * img.w as f64) as usize, (r.h * img.h as f64) as usize);
        img.crop(x, y, w.max(1), h.max(1))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeckConfig {
    /// Count "Card drawn from the deck" lines from Client.txt while a session runs.
    pub log_tracking: bool,
    /// Ground screenshots with the hotkey.
    pub ground_tracking: bool,
    /// Screenshot key ("" = off). Registered only while PoE 1 is the foreground window.
    pub hotkey: String,
    /// Part of the game window to read (fractions).
    pub region: Region,
    pub thresholds: Thresholds,
    /// Window (seconds) in which a card already seen at the same spot / in the log is flagged.
    pub dedupe_secs: u32,
    /// How close (fraction of the capture size) counts as "the same spot".
    pub dedupe_tolerance: f64,
    /// Keep the captured region (PNG, local only) so recognition can be retried.
    pub keep_screenshots: bool,
}

impl Default for DeckConfig {
    fn default() -> Self {
        Self {
            log_tracking: true,
            ground_tracking: true,
            hotkey: String::new(),
            region: Region::default(),
            thresholds: Thresholds::default(),
            dedupe_secs: 90,
            dedupe_tolerance: 0.02,
            keep_screenshots: true,
        }
    }
}

impl DeckConfig {
    fn sanitized(mut self) -> Self {
        self.region = self.region.sanitized();
        self.thresholds = self.thresholds.sanitized();
        self.dedupe_secs = self.dedupe_secs.min(3600);
        self.dedupe_tolerance = if self.dedupe_tolerance.is_finite() { self.dedupe_tolerance.clamp(0.002, 0.2) } else { 0.02 };
        self.hotkey = self.hotkey.trim().to_string();
        self
    }
}

// ---------- events ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCard {
    pub id: i64,
    pub card: Option<String>,
    pub status: String,
    /// Chaos per card from the session's league prices (manual price first); None = unknown.
    pub unit: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEvent {
    pub session_id: Option<i64>,
    pub source: &'static str,
    pub cards: Vec<DetectedCard>,
    pub ignored: usize,
    pub capture_id: Option<i64>,
    pub error: Option<String>,
    /// Estimated value of the session's confirmed cards after this change (priced cards only).
    pub session_value: Option<f64>,
    /// The session's acquisition cost, if entered.
    pub session_cost: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatus {
    pub path: Option<String>,
    pub watching: bool,
    pub last_read_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStatus {
    pub running: bool,
    pub file: Option<String>,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub cards_found: usize,
    pub sessions_created: usize,
    pub cards_added: usize,
    pub duplicates: usize,
    pub finished: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub league: Option<String>,
    /// Start a new session after this many minutes without a card (0 = one session).
    pub split_gap_minutes: u32,
}

// ---------- service ----------

pub struct DeckService {
    db: Arc<Database>,
    pub cards: cards::CardService,
    data_dir: PathBuf,
    matcher: Mutex<Option<Arc<Matcher>>>,
    wake: Arc<(Mutex<u64>, Condvar)>,
    log_status: Mutex<LogStatus>,
    busy: AtomicBool,
    last_press: Mutex<Option<Instant>>,
    import: Mutex<ImportStatus>,
    import_cancel: AtomicBool,
}

impl DeckService {
    pub fn new(db: Arc<Database>, data_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            db,
            cards: cards::CardService::new(data_dir.clone()),
            data_dir,
            matcher: Mutex::new(None),
            wake: Arc::new((Mutex::new(0), Condvar::new())),
            log_status: Mutex::new(LogStatus::default()),
            busy: AtomicBool::new(false),
            last_press: Mutex::new(None),
            import: Mutex::new(ImportStatus::default()),
            import_cancel: AtomicBool::new(false),
        })
    }

    pub fn config(&self) -> DeckConfig {
        settings::get_game(&self.db, GAME, CONFIG_KEY)
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_value::<DeckConfig>(v).ok())
            .unwrap_or_default()
            .sanitized()
    }

    pub fn set_config(&self, cfg: DeckConfig) -> AppResult<DeckConfig> {
        let cfg = cfg.sanitized();
        if let Some(p) = crate::loot::hotkeys::key_problem(&cfg.hotkey) {
            return Err(AppError::InvalidInput(p));
        }
        settings::set_game(&self.db, GAME, CONFIG_KEY, &serde_json::to_value(&cfg)?)?;
        self.notify();
        Ok(cfg)
    }

    pub fn log_status(&self) -> LogStatus {
        self.log_status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn import_status(&self) -> ImportStatus {
        self.import.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Wakes the Client.txt thread (session started / resumed / settings changed).
    pub fn notify(&self) {
        let (lock, cv) = &*self.wake;
        if let Ok(mut n) = lock.lock() {
            *n += 1;
            cv.notify_all();
        }
    }

    /// Card-name matcher: the card database plus card names poe.ninja knows for the league
    /// (a brand-new card is matchable before RePoE has it).
    fn matcher(&self, league: Option<&str>) -> Arc<Matcher> {
        if let Ok(guard) = self.matcher.lock() {
            if let Some(m) = guard.as_ref().filter(|m| !m.is_empty()) {
                return Arc::clone(m);
            }
        }
        let mut names: Vec<String> = crate::updates::installed_card_names(&self.db)
            .or_else(|| self.cards.cached().map(|d| d.cards.into_iter().map(|c| c.name).collect()))
            .unwrap_or_default();
        if let Some(l) = league {
            if let Ok(items) = crate::market::store::items(&self.db, GAME, l, MARKET_CATEGORY) {
                names.extend(items.into_iter().map(|i| i.name));
            }
        }
        let m = Arc::new(Matcher::new(names));
        if let Ok(mut guard) = self.matcher.lock() {
            *guard = Some(Arc::clone(&m));
        }
        m
    }

    pub fn reset_matcher(&self) {
        if let Ok(mut g) = self.matcher.lock() {
            *g = None;
        }
    }

    /// Market (poe.ninja) card prices for a league and their fetch time, plus the user's manual prices.
    pub fn prices(&self, league: Option<&str>) -> AppResult<(HashMap<String, f64>, Option<i64>, HashMap<String, f64>)> {
        let Some(league) = league else { return Ok((HashMap::new(), None, HashMap::new())) };
        let market = crate::market::store::items(&self.db, GAME, league, MARKET_CATEGORY)?.into_iter().map(|i| (i.name, i.value)).collect();
        let at = crate::market::store::fetch_meta(&self.db, GAME, league, MARKET_CATEGORY).ok().and_then(|m| m.fetched_at);
        let manual = store::overrides(&*self.db.conn()?, league)?;
        Ok((market, at, manual))
    }

    fn unit_of(prices: &(HashMap<String, f64>, Option<i64>, HashMap<String, f64>), card: Option<&str>) -> Option<f64> {
        let c = card?;
        prices.2.get(c).or_else(|| prices.0.get(c)).copied()
    }

    /// Estimated value of the session's confirmed cards at current prices (unpriced cards excluded).
    fn session_value(&self, s: &store::Session) -> AppResult<f64> {
        let counts = store::session_card_counts(&*self.db.conn()?, s.id)?;
        let prices = self.prices(s.league.as_deref())?;
        Ok(store::build_valuation(&counts, &prices.0, &prices.2, None, None, 0).total_value)
    }

    fn log_position_now(&self) -> Option<(Option<String>, u64)> {
        let path = crate::campaign::resolve_poe1_log(&self.db).ok()?;
        let p = crate::session::reader::probe(&path).ok()?;
        Some((p.key, p.size))
    }

    // ----- sessions -----

    pub fn create(&self, input: store::SessionInput) -> AppResult<i64> {
        let pos = if self.config().log_tracking { self.log_position_now() } else { None };
        let id = store::create(&self.db, input, now(), pos)?;
        self.notify();
        Ok(id)
    }

    pub fn pause(&self, id: i64) -> AppResult<()> {
        store::pause(&self.db, id, now())?;
        self.notify();
        Ok(())
    }

    pub fn resume(&self, id: i64) -> AppResult<()> {
        let pos = if self.config().log_tracking { self.log_position_now() } else { None };
        store::resume(&self.db, id, now(), pos)?;
        self.notify();
        Ok(())
    }

    /// Finishes the session; its card values are frozen as the original valuation.
    pub fn finish(&self, id: i64) -> AppResult<store::Valuation> {
        let (league, counts) = {
            let c = self.db.conn()?;
            (store::session(&c, id, now())?.league, store::session_card_counts(&c, id)?)
        };
        let prices = self.prices(league.as_deref())?;
        let v = store::build_valuation(&counts, &prices.0, &prices.2, league, prices.1, now());
        store::finish(&self.db, id, now(), &v)?;
        self.notify();
        Ok(v)
    }

    pub fn delete(&self, id: i64) -> AppResult<()> {
        for f in store::delete(&self.db, id)? {
            let _ = std::fs::remove_file(self.captures_dir().join(f));
        }
        self.notify();
        Ok(())
    }

    fn captures_dir(&self) -> PathBuf {
        self.data_dir.join("deck-captures")
    }

    // ----- Client.txt -----

    /// Background thread: reads new Client.txt lines every 2 s while a session is running with log
    /// tracking on; otherwise waits until woken (session start/resume, settings change).
    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let me = Arc::clone(self);
        std::thread::Builder::new()
            .name("deck-log".into())
            .spawn(move || loop {
                let seen = me.wake.0.lock().map(|n| *n).unwrap_or(0);
                let active = me.db.conn().ok().and_then(|c| store::active(&c, now()).ok().flatten());
                let running = active.as_ref().filter(|s| s.status == "running");
                let cfg = me.config();
                let wait = match running {
                    Some(s) if cfg.log_tracking => {
                        me.read_log(&app, s, &cfg);
                        Some(LOG_INTERVAL)
                    }
                    _ => {
                        if let Ok(mut st) = me.log_status.lock() {
                            st.watching = false;
                        }
                        None
                    }
                };
                let (lock, cv) = &*me.wake;
                let Ok(guard) = lock.lock() else { return };
                if *guard != seen {
                    continue;
                }
                match wait {
                    Some(d) => drop(cv.wait_timeout(guard, d)),
                    None => drop(cv.wait_while(guard, |n| *n == seen)),
                }
            })
            .expect("spawn deck log thread");
    }

    fn read_log(&self, app: &AppHandle, s: &store::Session, cfg: &DeckConfig) {
        let path = match crate::campaign::resolve_poe1_log(&self.db) {
            Ok(p) => p,
            Err(e) => {
                self.set_log_error(None, Some(public(&e)));
                return;
            }
        };
        let result = self.read_log_file(s, &path, cfg);
        match result {
            Ok(added) => {
                self.set_log_error(Some(&path), None);
                if !added.is_empty() {
                    let _ = app.emit(EVENT_UPDATED, s.id);
                    let session_value = self.session_value(s).ok();
                    let _ = app.emit(EVENT_DETECTED, DetectedEvent { session_id: Some(s.id), source: "log", cards: added, ignored: 0, capture_id: None, error: None, session_value, session_cost: s.cost_total });
                }
            }
            Err(e) => self.set_log_error(Some(&path), Some(e)),
        }
    }

    fn set_log_error(&self, path: Option<&Path>, error: Option<String>) {
        if let Ok(mut st) = self.log_status.lock() {
            st.watching = error.is_none();
            st.path = path.map(|p| crate::session::discover::masked(p));
            st.last_read_at = Some(now());
            st.error = error;
        }
    }

    fn read_log_file(&self, s: &store::Session, path: &Path, cfg: &DeckConfig) -> Result<Vec<DetectedCard>, String> {
        let (key, offset) = store::log_position(&*self.db.conn().map_err(|e| e.to_string())?, s.id).map_err(|e| e.to_string())?;
        let (mut key, mut offset) = match offset {
            Some(o) => (key, o),
            None => {
                // No position yet (log found only now): start at the end — old lines are not this session.
                let p = crate::session::reader::probe(path).map_err(|e| e.to_string())?;
                (p.key, p.size)
            }
        };
        let matcher = self.matcher(s.league.as_deref());
        let prices = self.prices(s.league.as_deref()).map_err(|e| public(&e))?;
        let mut added = Vec::new();
        for _ in 0..8 {
            let chunk = crate::session::reader::read_from(path, key.as_deref(), offset, LOG_CHUNK).map_err(|e| format!("Couldn't read Client.txt: {e}"))?;
            let file_key = chunk.key.clone().unwrap_or_else(|| "nokey".into());
            let c = self.db.conn().map_err(|e| e.to_string())?;
            for (at_offset, line) in &chunk.lines {
                let Some((stamp, raw)) = logparse::card_drawn(line) else { continue };
                let card = matcher.canonical(&raw).map(str::to_owned).unwrap_or(raw);
                let at = crate::session::localtime::local_to_unix(stamp).unwrap_or_else(now);
                let e = store::NewEvent {
                    session_id: s.id,
                    at,
                    source: "log",
                    source_uid: format!("log:{file_key}:{at_offset}"),
                    capture_id: None,
                    recognized_text: None,
                    recognized_card: None,
                    confidence: 1.0,
                    bbox: None,
                    card: Some(card.clone()),
                    status: "confirmed",
                    review_reason: None,
                };
                if let Some(id) = store::insert_event(&c, &e).map_err(|e| e.to_string())? {
                    // A ground screenshot may already have this card: flag the OCR entry, not the log line.
                    if cfg.ground_tracking {
                        let since = at - cfg.dedupe_secs as i64;
                        for o in store::recent_of_card(&c, s.id, &card, since, Some("ocr")).map_err(|e| e.to_string())?.into_iter().take(1) {
                            if o.status != "review" && !o.corrected {
                                let _ = store::set_event_status(&c, o.id, "review", Some("Also recorded from Client.txt — probably the same card"));
                            }
                        }
                    }
                    added.push(DetectedCard { id, unit: Self::unit_of(&prices, Some(&card)), card: Some(card), status: "confirmed".into() });
                }
            }
            store::set_log_position(&c, s.id, chunk.key.as_deref(), chunk.offset).map_err(|e| e.to_string())?;
            key = chunk.key;
            offset = chunk.offset;
            if chunk.remaining == 0 {
                break;
            }
        }
        Ok(added)
    }

    // ----- ground screenshots -----

    /// Hotkey pressed (PoE 1 in the foreground). One press = one screenshot.
    pub fn on_hotkey(self: &Arc<Self>, app: &AppHandle) {
        {
            let Ok(mut last) = self.last_press.lock() else { return };
            if last.is_some_and(|t| t.elapsed() < HOTKEY_DEBOUNCE) {
                return;
            }
            *last = Some(Instant::now());
        }
        let fail = |msg: String, session_id: Option<i64>| {
            let _ = app.emit(EVENT_DETECTED, DetectedEvent { session_id, source: "ocr", cards: Vec::new(), ignored: 0, capture_id: None, error: Some(msg), session_value: None, session_cost: None });
        };
        let cfg = self.config();
        let session = self.db.conn().ok().and_then(|c| store::active(&c, now()).ok().flatten());
        let Some(session) = session.filter(|s| s.status == "running") else {
            return fail("No running Deck Intelligence session — start or resume one first.".into(), None);
        };
        if !cfg.ground_tracking {
            return fail("Ground screenshots are turned off in Deck Intelligence settings.".into(), Some(session.id));
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            return fail("Still reading the previous screenshot.".into(), Some(session.id));
        }
        let shot = crate::loot::inventory::capture::game_window_of(GAME);
        let img = match shot {
            Ok(img) => cfg.region.crop(&img),
            Err(e) => {
                self.busy.store(false, Ordering::SeqCst);
                return fail(e, Some(session.id));
            }
        };
        let me = Arc::clone(self);
        let app = app.clone();
        std::thread::spawn(move || {
            let r = me.new_capture(&session, img, "hotkey", &cfg);
            me.busy.store(false, Ordering::SeqCst);
            me.emit_capture(&app, session.id, r);
        });
    }

    fn emit_capture(&self, app: &AppHandle, session_id: i64, r: AppResult<DetectedEvent>) {
        let ev = r.unwrap_or_else(|e| DetectedEvent { session_id: Some(session_id), source: "ocr", cards: Vec::new(), ignored: 0, capture_id: None, error: Some(public(&e)), session_value: None, session_cost: None });
        let _ = app.emit(EVENT_UPDATED, session_id);
        let _ = app.emit(EVENT_DETECTED, ev);
    }

    /// A screenshot file the user picked (same pipeline, source "file").
    pub fn recognize_file(&self, app: &AppHandle, session_id: i64, path: &Path) -> AppResult<DetectedEvent> {
        let session = {
            let c = self.db.conn()?;
            store::require_open(&c, session_id)?;
            store::session(&c, session_id, now())?
        };
        let bytes = std::fs::read(path)?;
        let img = Rgba::from_png(&bytes).map_err(|e| AppError::InvalidInput(format!("Couldn't read that PNG: {e}")))?;
        let cfg = self.config();
        let r = self.new_capture(&session, img, "file", &cfg);
        let out = r.as_ref().map(Clone::clone).map_err(|e| AppError::InvalidInput(public(e)));
        self.emit_capture(app, session_id, r);
        out
    }

    fn new_capture(&self, s: &store::Session, img: Rgba, source: &str, cfg: &DeckConfig) -> AppResult<DetectedEvent> {
        let taken = now();
        let file = if cfg.keep_screenshots {
            std::fs::create_dir_all(self.captures_dir())?;
            static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let name = format!("s{}-{}-{}.png", s.id, taken, SEQ.fetch_add(1, Ordering::Relaxed));
            let png = img.to_png().map_err(AppError::InvalidInput)?;
            std::fs::write(self.captures_dir().join(&name), png)?;
            Some(name)
        } else {
            None
        };
        let region = serde_json::to_string(&cfg.region)?;
        let capture_id = store::insert_capture(&*self.db.conn()?, s.id, taken, source, file.as_deref(), img.w, img.h, &region, recognize::RECOGNIZER_VERSION)?;
        self.recognize_capture(s, capture_id, &img, taken, cfg)
    }

    /// Re-runs recognition on a stored screenshot. Corrected entries are kept as they are.
    pub fn retry(&self, app: &AppHandle, capture_id: i64) -> AppResult<DetectedEvent> {
        let (session_id, _, _, file) = store::capture_file(&*self.db.conn()?, capture_id)?;
        let s = {
            let c = self.db.conn()?;
            store::require_open(&c, session_id)?;
            store::session(&c, session_id, now())?
        };
        let file = file.ok_or_else(|| AppError::InvalidInput("This screenshot wasn't kept, so it can't be read again.".into()))?;
        let img = Rgba::from_png(&std::fs::read(self.captures_dir().join(file))?).map_err(AppError::InvalidInput)?;
        let taken = self.db.conn()?.query_row("SELECT taken_at FROM deck_captures WHERE id = ?1", [capture_id], |r| r.get::<_, i64>(0))?;
        store::clear_uncorrected(&*self.db.conn()?, capture_id)?;
        let r = self.recognize_capture(&s, capture_id, &img, taken, &self.config());
        let out = r.as_ref().map(Clone::clone).map_err(|e| AppError::InvalidInput(public(e)));
        self.emit_capture(app, session_id, r);
        out
    }

    pub fn capture_image(&self, capture_id: i64) -> AppResult<Option<String>> {
        let (_, _, _, file) = store::capture_file(&*self.db.conn()?, capture_id)?;
        Ok(file.and_then(|f| std::fs::read(self.captures_dir().join(f)).ok()).map(|b| format!("data:image/png;base64,{}", crate::loot::inventory::service::base64(&b))))
    }

    fn recognize_capture(&self, s: &store::Session, capture_id: i64, img: &Rgba, taken: i64, cfg: &DeckConfig) -> AppResult<DetectedEvent> {
        let matcher = self.matcher(s.league.as_deref());
        if matcher.is_empty() {
            let msg = "The Divination Card list isn't loaded yet — open Deck Intelligence once while online.";
            store::finish_capture(&*self.db.conn()?, capture_id, 0, 0, Some(msg))?;
            return Err(AppError::InvalidInput(msg.into()));
        }
        let lines = match ocr::recognize(img) {
            Ok(l) => l,
            Err(e) => {
                store::finish_capture(&*self.db.conn()?, capture_id, 0, 0, Some(&e))?;
                return Err(AppError::InvalidInput(e));
            }
        };
        let rec = recognize::recognize(&lines, &matcher, cfg.thresholds);
        let prices = self.prices(s.league.as_deref())?;
        let mut c = self.db.conn()?;
        let tx = c.transaction()?;
        // Earlier detections that could be the same physical labels (previous screenshots in the window).
        let since = taken - cfg.dedupe_secs as i64;
        let mut earlier: Vec<(store::Event, (f64, f64))> = Vec::new();
        for (cid, w, h) in store::recent_captures(&tx, s.id, since, capture_id)? {
            for e in store::capture_events(&tx, cid)? {
                if e.status != "removed" {
                    earlier.push((e, (w as f64, h as f64)));
                }
            }
        }
        let mut used: HashSet<i64> = HashSet::new();
        // Kept corrections of this capture (retry) also "use up" their label.
        let kept: Vec<store::Event> = store::capture_events(&tx, capture_id)?;
        let size = (img.w as f64, img.h as f64);
        let mut cards = Vec::new();
        for (n, d) in rec.detections.iter().enumerate() {
            let rect = d.rect.clone();
            if kept.iter().any(|k| k.bbox.as_ref().and_then(|b| serde_json::from_value::<ocr::Rect>(b.clone()).ok()).is_some_and(|b| b.iou(&rect) > 0.5)) {
                continue;
            }
            let suggestion = d.best.as_ref().map(|m| m.card.clone());
            let confidence = d.best.as_ref().map_or(0.0, |m| m.score);
            let (mut status, mut reason, card) = match d.verdict {
                Verdict::Confirmed => ("confirmed", None, suggestion.clone()),
                Verdict::Review => ("review", Some(review_reason(d)), suggestion.clone()),
                _ => ("unrecognized", Some("No reliable match — pick the card or remove it".to_string()), None),
            };
            if let Some(cardname) = card.as_deref() {
                let dup = earlier.iter().find(|(e, esize)| {
                    !used.contains(&e.id)
                        && e.card.as_deref() == Some(cardname)
                        && e.bbox.as_ref().and_then(|b| serde_json::from_value::<ocr::Rect>(b.clone()).ok()).is_some_and(|b| recognize::same_spot(&b, *esize, &rect, size, cfg.dedupe_tolerance))
                });
                if let Some((e, _)) = dup {
                    used.insert(e.id);
                    status = "review";
                    reason = Some(format!("Possibly the same label as in an earlier screenshot (entry #{})", e.id));
                } else if cfg.log_tracking && !store::recent_of_card(&tx, s.id, cardname, since, Some("log"))?.is_empty() {
                    status = "review";
                    reason = Some("Also recorded from Client.txt — probably the same card".into());
                }
            }
            let e = store::NewEvent {
                session_id: s.id,
                at: taken,
                source: "ocr",
                source_uid: format!("ocr:{capture_id}:{n}:{}", now()),
                capture_id: Some(capture_id),
                recognized_text: Some(d.text.chars().take(200).collect()),
                recognized_card: suggestion,
                confidence,
                bbox: Some(serde_json::to_string(&rect)?),
                card: card.clone(),
                status,
                review_reason: reason,
            };
            if let Some(id) = store::insert_event(&tx, &e)? {
                cards.push(DetectedCard { id, unit: Self::unit_of(&prices, card.as_deref()), card, status: status.into() });
            }
        }
        store::finish_capture(&tx, capture_id, rec.ocr_lines, rec.ignored, None)?;
        tx.commit()?;
        drop(c);
        let session_value = self.session_value(s).ok();
        Ok(DetectedEvent { session_id: Some(s.id), source: "ocr", cards, ignored: rec.ignored, capture_id: Some(capture_id), error: None, session_value, session_cost: s.cost_total })
    }

    // ----- entries -----

    pub fn confirm(&self, id: i64) -> AppResult<()> {
        let c = self.db.conn()?;
        let e = store::event(&c, id)?;
        store::require_open(&c, e.session_id)?;
        if e.card.is_none() {
            return Err(AppError::InvalidInput("Pick the card first.".into()));
        }
        store::set_event_status(&c, id, "confirmed", None)
    }

    pub fn remove(&self, id: i64) -> AppResult<()> {
        let c = self.db.conn()?;
        let e = store::event(&c, id)?;
        store::require_open(&c, e.session_id)?;
        store::set_event_status(&c, id, "removed", None)
    }

    pub fn restore(&self, id: i64) -> AppResult<()> {
        let c = self.db.conn()?;
        let e = store::event(&c, id)?;
        store::require_open(&c, e.session_id)?;
        let status = if e.card.is_none() { "unrecognized" } else { "review" };
        store::set_event_status(&c, id, status, Some("Restored — check it"))
    }

    pub fn correct(&self, id: i64, card: &str) -> AppResult<()> {
        let league = {
            let c = self.db.conn()?;
            let e = store::event(&c, id)?;
            store::require_open(&c, e.session_id)?;
            store::session(&c, e.session_id, now())?.league
        };
        let canonical = self.matcher(league.as_deref()).canonical(card).map(str::to_owned).ok_or_else(|| AppError::InvalidInput(format!("\"{card}\" isn't a known Divination Card.")))?;
        store::correct_event(&*self.db.conn()?, id, &canonical, now())
    }

    pub fn add_manual(&self, session_id: i64, card: &str, qty: u32) -> AppResult<usize> {
        if qty == 0 || qty > 500 {
            return Err(AppError::InvalidInput("Add between 1 and 500 cards at a time.".into()));
        }
        let league = {
            let c = self.db.conn()?;
            store::require_open(&c, session_id)?;
            store::session(&c, session_id, now())?.league
        };
        let canonical = self.matcher(league.as_deref()).canonical(card).map(str::to_owned).ok_or_else(|| AppError::InvalidInput(format!("\"{card}\" isn't a known Divination Card.")))?;
        let mut c = self.db.conn()?;
        let tx = c.transaction()?;
        let at = now();
        static MANUAL_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let salt = format!("{}-{}", std::process::id(), MANUAL_SEQ.fetch_add(1, Ordering::Relaxed));
        let mut added = 0;
        for i in 0..qty {
            let e = store::NewEvent {
                session_id,
                at,
                source: "manual",
                source_uid: format!("man:{session_id}:{at}:{salt}:{i}"),
                capture_id: None,
                recognized_text: None,
                recognized_card: None,
                confidence: 1.0,
                bbox: None,
                card: Some(canonical.clone()),
                status: "confirmed",
                review_reason: None,
            };
            if store::insert_event(&tx, &e)?.is_some() {
                added += 1;
            }
        }
        tx.commit()?;
        Ok(added)
    }

    // ----- historical import -----

    /// Imports "Card drawn from the deck" lines from a Client.txt on a worker thread, with progress
    /// (`decks:import`) and cancellation. Lines already stored (live or earlier import) are skipped.
    pub fn import(self: &Arc<Self>, app: &AppHandle, path: PathBuf, opts: ImportOptions) -> AppResult<()> {
        {
            let mut st = self.import.lock().map_err(|_| AppError::StatePoisoned)?;
            if st.running {
                return Err(AppError::InvalidInput("An import is already running.".into()));
            }
            let total = std::fs::metadata(&path)?.len();
            *st = ImportStatus { running: true, file: Some(crate::session::discover::masked(&path)), bytes_total: total, ..Default::default() };
        }
        self.import_cancel.store(false, Ordering::SeqCst);
        let me = Arc::clone(self);
        let app = app.clone();
        std::thread::Builder::new()
            .name("deck-import".into())
            .spawn(move || {
                let r = me.run_import(&app, &path, &opts);
                let mut st = me.import.lock().map(|s| s.clone()).unwrap_or_default();
                st.running = false;
                st.finished = true;
                if let Err(e) = r {
                    st.error = Some(e);
                }
                if let Ok(mut g) = me.import.lock() {
                    *g = st.clone();
                }
                let _ = app.emit(EVENT_IMPORT, st);
                let _ = app.emit(EVENT_UPDATED, 0);
            })
            .map_err(AppError::Io)?;
        Ok(())
    }

    pub fn cancel_import(&self) {
        self.import_cancel.store(true, Ordering::SeqCst);
    }

    fn run_import(&self, app: &AppHandle, path: &Path, opts: &ImportOptions) -> Result<(), String> {
        let mut key: Option<String> = None;
        let mut offset = 0u64;
        let mut found: Vec<(i64, String, String)> = Vec::new();
        let matcher = self.matcher(opts.league.as_deref());
        let mut last_emit = Instant::now();
        loop {
            if self.import_cancel.load(Ordering::SeqCst) {
                if let Ok(mut st) = self.import.lock() {
                    st.cancelled = true;
                }
                return Ok(()); // nothing was written yet
            }
            let chunk = crate::session::reader::read_from(path, key.as_deref(), offset, 4 * LOG_CHUNK).map_err(|e| format!("Couldn't read the file: {e}"))?;
            let file_key = chunk.key.clone().unwrap_or_else(|| "nokey".into());
            for (at_offset, line) in &chunk.lines {
                if let Some((stamp, raw)) = logparse::card_drawn(line) {
                    let card = matcher.canonical(&raw).map(str::to_owned).unwrap_or(raw);
                    let at = crate::session::localtime::local_to_unix(stamp).unwrap_or(0);
                    found.push((at, format!("log:{file_key}:{at_offset}"), card));
                }
            }
            key = chunk.key;
            offset = chunk.offset;
            if let Ok(mut st) = self.import.lock() {
                st.bytes_done = offset;
                st.cards_found = found.len();
                if last_emit.elapsed() > Duration::from_millis(200) {
                    let _ = app.emit(EVENT_IMPORT, st.clone());
                    last_emit = Instant::now();
                }
            }
            if chunk.remaining == 0 {
                break;
            }
        }
        // Group into sessions by gaps between cards.
        found.sort_by_key(|e| e.0);
        let gap = opts.split_gap_minutes as i64 * 60;
        let mut groups: Vec<Vec<(i64, String, String)>> = Vec::new();
        for e in found {
            match groups.last_mut() {
                Some(g) if gap == 0 || e.0 - g.last().map_or(e.0, |l| l.0) <= gap => g.push(e),
                _ => groups.push(vec![e]),
            }
        }
        let prices = self.prices(opts.league.as_deref()).map_err(|e| public(&e))?;
        let (mut sessions, mut added, mut dupes) = (0, 0, 0);
        for g in groups {
            let name = format!("Imported · {}", date_label(g[0].0));
            let total = g.len();
            let league = opts.league.clone();
            let r = store::insert_imported(&self.db, &name, opts.league.as_deref(), &g, now(), |counts| store::build_valuation(counts, &prices.0, &prices.2, league.clone(), prices.1, now()))
                .map_err(|e| public(&e))?;
            match r {
                Some((_, n)) => {
                    sessions += 1;
                    added += n;
                    dupes += total - n;
                }
                None => dupes += total,
            }
        }
        if let Ok(mut st) = self.import.lock() {
            st.sessions_created = sessions;
            st.cards_added = added;
            st.duplicates = dupes;
        }
        Ok(())
    }
}

fn review_reason(d: &recognize::Detection) -> String {
    match &d.best {
        Some(m) if m.runner_up > 0.0 && m.score - m.runner_up < 0.08 => {
            format!("Read “{}” — could also be {}", d.text, m.runner_up_card.as_deref().unwrap_or("another card"))
        }
        _ => format!("Read “{}” — not an exact match", d.text),
    }
}

/// YYYY-MM-DD (UTC) for session names.
fn date_label(unix: i64) -> String {
    let days = unix.div_euclid(86_400);
    // civil from days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

/// The user-facing text of an error (same as what the frontend receives).
fn public(e: &AppError) -> String {
    match e {
        AppError::InvalidInput(m) => m.clone(),
        other => {
            log::warn!("deck intelligence: {other}");
            "A local operation failed — see the log.".into()
        }
    }
}

/// Hotkey to register while PoE 1 is in the foreground ("" = none).
pub fn hotkey(app: &AppHandle) -> Option<String> {
    let s = app.try_state::<crate::AppState>()?;
    let cfg = s.decks.config();
    (cfg.ground_tracking && !cfg.hotkey.is_empty() && crate::loot::hotkeys::key_problem(&cfg.hotkey).is_none()).then_some(cfg.hotkey)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_is_clamped() {
        let r = Region { x: -1.0, y: 0.95, w: 5.0, h: 0.0 }.sanitized();
        assert_eq!((r.x, r.y), (0.0, 0.9));
        assert!((r.w - 1.0).abs() < 1e-9);
        assert!((r.h - 0.1).abs() < 1e-9);
        let img = Rgba::new(200, 100);
        let c = Region { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }.crop(&img);
        assert_eq!((c.w, c.h), (100, 50));
    }

    #[test]
    fn config_defaults_and_sanitizing() {
        let c: DeckConfig = serde_json::from_str("{}").unwrap();
        assert!(c.log_tracking && c.ground_tracking && c.keep_screenshots);
        assert_eq!(c.hotkey, "");
        let s = DeckConfig { dedupe_secs: 99_999, dedupe_tolerance: f64::NAN, ..Default::default() }.sanitized();
        assert_eq!((s.dedupe_secs, s.dedupe_tolerance), (3600, 0.02));
    }

    #[test]
    fn date_labels() {
        assert_eq!(date_label(0), "1970-01-01");
        assert_eq!(date_label(1_774_000_000), "2026-03-20");
    }

    fn service() -> (Arc<DeckService>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open_in_memory().unwrap());
        let s = DeckService::new(db, dir.path().to_path_buf());
        *s.matcher.lock().unwrap() = Some(Arc::new(Matcher::new(["The Lover", "Rain of Chaos", "The Doctor"].map(String::from))));
        (s, dir)
    }

    fn input() -> store::SessionInput {
        store::SessionInput { name: "T".into(), league: None, opened_on: None, planned_decks: None, acquisition: store::Acquisition::Unknown, cost_total: None, notes: None }
    }

    #[test]
    fn log_lines_become_events_once() {
        let (svc, dir) = service();
        let log = dir.path().join("Client.txt");
        let head = "2026/11/25 15:00:00 1 a [INFO Client 1] ***** LOG FILE OPENING *****padding-padding-padding\n";
        std::fs::write(&log, head).unwrap();
        let id = store::create(&svc.db, input(), 100, Some((crate::session::reader::probe(&log).unwrap().key, head.len() as u64))).unwrap();
        let s = store::session(&svc.db.conn().unwrap(), id, 100).unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).open(&log).unwrap();
        use std::io::Write;
        writeln!(f, "2026/11/25 15:04:02 10325187 cffb06be [INFO Client 12060] : Card drawn from the deck: <divination>{{The Lover}}").unwrap();
        writeln!(f, "2026/11/25 15:04:02 10325187 cffb06be [INFO Client 12060] #Chat: Card drawn from the deck: <divination>{{The Doctor}}").unwrap();
        writeln!(f, "2026/11/25 15:04:03 10325187 cffb06be [INFO Client 12060] : Card drawn from the deck: <divination>{{rain of chaos}}").unwrap();
        drop(f);
        let cfg = DeckConfig::default();
        let added = svc.read_log_file(&s, &log, &cfg).unwrap();
        assert_eq!(added.iter().map(|a| a.card.clone().unwrap()).collect::<Vec<_>>(), ["The Lover", "Rain of Chaos"]);
        // Reading again adds nothing (offset persisted).
        assert!(svc.read_log_file(&s, &log, &cfg).unwrap().is_empty());
        let ev = store::events(&svc.db.conn().unwrap(), id).unwrap();
        assert_eq!(ev.len(), 2);
        // Import of the same file: the two lines are already stored.
        let st = svc.run_import_sync(&log);
        assert_eq!((st.0, st.1), (0, 2));
    }

    #[test]
    fn entries_are_read_only_after_finish() {
        let (svc, _dir) = service();
        let id = store::create(&svc.db, input(), 100, None).unwrap();
        assert_eq!(svc.add_manual(id, "the lover", 2).unwrap(), 2);
        // Two batches in the same second must not collide.
        assert_eq!(svc.add_manual(id, "Rain of Chaos", 2).unwrap(), 2);
        assert_eq!(store::events(&svc.db.conn().unwrap(), id).unwrap().len(), 4);
        assert!(svc.add_manual(id, "Not A Card", 1).is_err());
        let ev = store::events(&svc.db.conn().unwrap(), id).unwrap();
        svc.remove(ev[0].id).unwrap();
        svc.restore(ev[0].id).unwrap();
        assert_eq!(store::event(&svc.db.conn().unwrap(), ev[0].id).unwrap().status, "review");
        svc.correct(ev[0].id, "The Doctor").unwrap();
        let e = store::event(&svc.db.conn().unwrap(), ev[0].id).unwrap();
        assert_eq!((e.card.as_deref(), e.status.as_str(), e.corrected), (Some("The Doctor"), "confirmed", true));
        let v = svc.finish(id).unwrap();
        assert_eq!((v.priced_cards, v.unpriced_cards), (0, 4), "no prices known: unpriced, not zero");
        assert!(svc.add_manual(id, "The Lover", 1).is_err());
        assert!(svc.remove(ev[1].id).is_err());
    }

    impl DeckService {
        /// (cards added, duplicates) of a synchronous import, for tests.
        fn run_import_sync(&self, path: &Path) -> (usize, usize) {
            let mut key: Option<String> = None;
            let mut offset = 0;
            let mut found = Vec::new();
            loop {
                let chunk = crate::session::reader::read_from(path, key.as_deref(), offset, LOG_CHUNK).unwrap();
                let k = chunk.key.clone().unwrap_or_else(|| "nokey".into());
                for (o, l) in &chunk.lines {
                    if let Some((st, raw)) = logparse::card_drawn(l) {
                        let card = self.matcher(None).canonical(&raw).map(str::to_owned).unwrap_or(raw);
                        found.push((crate::session::localtime::local_to_unix(st).unwrap_or(0), format!("log:{k}:{o}"), card));
                    }
                }
                key = chunk.key;
                offset = chunk.offset;
                if chunk.remaining == 0 {
                    break;
                }
            }
            let total = found.len();
            let r = store::insert_imported(&self.db, "I", None, &found, 1, |c| store::build_valuation(c, &HashMap::new(), &HashMap::new(), None, None, 1)).unwrap();
            let n = r.map_or(0, |x| x.1);
            (n, total - n)
        }
    }
}
