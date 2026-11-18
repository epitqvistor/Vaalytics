//! Session tracker: the state machine behind Session Intelligence. Pure Rust
//! (no Tauri), driven by `tick()` from the service thread, so it can be tested
//! with a fake process source, a temp log file and an in-memory database.
//!
//! A session is one run of the game client: it starts when the PoE 2 process
//! appears and ends when it disappears. Area visits and events come from
//! `Client.txt`. All writes for one log chunk (visits, events, reader offset,
//! summary) happen in one transaction, so a crash can't duplicate or lose half
//! of a chunk; an active session left behind by a crash is resumed (same
//! process still running) or closed at its last activity (process gone).

use super::areas;
use super::discover::{self, LogCheck};
use super::log_format::{self, LineResult, LocalStamp, LogEvent};
use super::process::{pick_poe2, ProcInfo, ProcessSource};
use super::reader::{self, Reset};
use super::store::{self, NewVisit, SessionSummary, VisitRow};
use crate::db::Database;
use crate::error::AppResult;
use crate::game::GameId;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Lines older than the session start by more than this belong to an earlier run.
const START_MARGIN_SECS: i64 = 60;
/// Read at most this much per chunk / per tick while live.
const CHUNK_BYTES: usize = 1024 * 1024;
const MAX_CHUNKS_PER_TICK: usize = 4;
/// When the stored position is further behind than this, jump to the current run.
const MAX_CATCH_UP_BYTES: u64 = 64 * 1024 * 1024;
/// How far back to look for the start of the current client run.
const START_SEARCH_WINDOW: u64 = 32 * 1024 * 1024;
/// Sessions shorter than this without maps are dropped unless the user keeps them.
pub const SHORT_SESSION_SECS: i64 = 120;
pub const CONFIG_KEY: &str = "sessions.config";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub auto_detect: bool,
    pub auto_track: bool,
    pub auto_discover: bool,
    /// Track a game that was already running when Vaalytics started.
    pub attach_to_running: bool,
    pub keep_short_sessions: bool,
    pub poll_secs: u32,
    pub debug_logging: bool,
    pub notify_on_summary: bool,
    /// 0 = keep forever.
    pub retention_days: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            auto_detect: true,
            auto_track: true,
            auto_discover: true,
            attach_to_running: true,
            keep_short_sessions: false,
            poll_secs: 5,
            debug_logging: false,
            notify_on_summary: false,
            retention_days: 0,
        }
    }
}

impl Config {
    pub fn sanitized(mut self) -> Self {
        self.poll_secs = self.poll_secs.clamp(3, 30);
        self.retention_days = self.retention_days.min(3650);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackState {
    NotDetected,
    Detected,
    Tracking,
    ReadingLog,
    Reconnecting,
    Paused,
    Completed,
    Error,
}

#[derive(Debug, Clone, Default)]
struct LogRuntime {
    path: Option<PathBuf>,
    manual: bool,
    check: Option<LogCheck>,
    key: Option<String>,
    offset: u64,
    size: u64,
    backlog: u64,
    error: Option<String>,
    last_read_at: Option<i64>,
    last_line_at: Option<i64>,
    lines_read: u64,
    events_parsed: u64,
    parse_errors: u64,
    skipped_long_lines: u64,
    resets: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcStatus {
    pub pid: u32,
    pub started_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogStatus {
    pub found: bool,
    /// Masked path (`…\Path of Exile 2\logs\Client.txt`).
    pub label: Option<String>,
    pub manual: bool,
    pub confirmed_poe2: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: TrackState,
    pub message: Option<String>,
    pub paused: bool,
    pub process: Option<ProcStatus>,
    pub active_session: Option<SessionSummary>,
    pub current_area: Option<VisitRow>,
    pub last_completed_id: Option<i64>,
    pub log: LogStatus,
    pub config: Config,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub state: TrackState,
    pub message: Option<String>,
    pub process_name: Option<String>,
    pub process_id: Option<u32>,
    pub process_started_at: Option<i64>,
    pub log_path: Option<String>,
    pub log_manual: bool,
    pub log_exists: bool,
    pub log_check: Option<String>,
    pub log_size: u64,
    pub offset: u64,
    pub backlog_bytes: u64,
    pub file_key: Option<String>,
    pub last_read_at: Option<i64>,
    pub last_line_at: Option<i64>,
    pub lines_read: u64,
    pub events_parsed: u64,
    pub parse_errors: u64,
    pub skipped_long_lines: u64,
    pub log_resets: u64,
    pub last_error: Option<String>,
    pub session_id: Option<i64>,
    pub poll_secs: u32,
    pub scans: u64,
    pub last_scan_at: Option<i64>,
    pub last_scan_ms: Option<u64>,
}

#[derive(Debug, Default, PartialEq)]
pub struct TickOutcome {
    pub changed: bool,
    /// Session completed during this tick (game closed).
    pub completed: Option<i64>,
    /// More log data waits; tick again soon.
    pub more_pending: bool,
}

pub type Clock = Box<dyn Fn() -> i64 + Send>;
pub type Discoverer = Box<dyn Fn(Option<&ProcInfo>) -> Option<PathBuf> + Send>;

/// Default discovery: the running client's folder, then known install locations.
pub fn default_discoverer() -> Discoverer {
    Box::new(|p: Option<&ProcInfo>| {
        if let Some(path) = p.and_then(|p| p.exe.as_deref()).and_then(discover::from_exe) {
            if discover::validate(&path).is_ok() {
                return Some(path);
            }
        }
        discover::candidates().into_iter().find(|c| discover::validate(c).is_ok())
    })
}

pub struct Tracker {
    game: GameId,
    db: Arc<Database>,
    procs: Box<dyn ProcessSource>,
    now: Clock,
    to_unix: fn(LocalStamp) -> Option<i64>,
    discover: Discoverer,
    pub config: Config,
    paused: bool,
    process: Option<ProcInfo>,
    last_seen_running: i64,
    skipped: Option<(u32, i64)>,
    first_scan_done: bool,
    session: Option<SessionSummary>,
    /// Open visit and whether it still needs its display name.
    open_visit: Option<(i64, bool)>,
    log: LogRuntime,
    last_completed: Option<i64>,
    next_scan_at: i64,
    scan_error: Option<String>,
    last_error: Option<String>,
    scans: u64,
    last_scan_at: Option<i64>,
    last_scan_ms: Option<u64>,
    last_state: Option<(TrackState, Option<String>)>,
    last_touch: i64,
    last_resolve_at: i64,
    /// Campaign Intelligence attribution, fed from this reader (no second reader).
    campaign: crate::campaign::CampaignHook,
}

impl Tracker {
    pub fn new(game: GameId, db: Arc<Database>, procs: Box<dyn ProcessSource>, now: Clock, to_unix: fn(LocalStamp) -> Option<i64>, discover: Discoverer) -> Self {
        Self {
            game,
            db,
            procs,
            now,
            to_unix,
            discover,
            config: Config::default(),
            campaign: crate::campaign::CampaignHook::live(game),
            paused: false,
            process: None,
            last_seen_running: 0,
            skipped: None,
            first_scan_done: false,
            session: None,
            open_visit: None,
            log: LogRuntime::default(),
            last_completed: None,
            next_scan_at: 0,
            scan_error: None,
            last_error: None,
            scans: 0,
            last_scan_at: None,
            last_scan_ms: None,
            last_state: None,
            last_touch: 0,
            last_resolve_at: i64::MIN / 2,
        }
    }

    pub fn game(&self) -> GameId {
        self.game
    }

    pub fn session_active(&self) -> bool {
        self.session.is_some()
    }

    pub fn set_config(&mut self, c: Config) {
        self.config = c.sanitized();
        self.next_scan_at = 0;
        self.last_resolve_at = i64::MIN / 2;
    }

    pub fn set_paused(&mut self, paused: bool) -> AppResult<()> {
        if self.paused == paused {
            return Ok(());
        }
        self.paused = paused;
        let now = (self.now)();
        if let Some(s) = &self.session {
            store::insert_event(&*self.db.conn()?, self.game, s.id, now, if paused { "paused" } else { "resumed" }, None, None)?;
        }
        if !paused {
            // Lines written while paused are not recorded: continue from the end.
            if let Some(path) = self.log.path.clone() {
                if let Ok(p) = reader::probe(&path) {
                    self.log.offset = p.size;
                    self.log.key = p.key;
                    store::save_position(&*self.db.conn()?, self.game, self.log.key.as_deref(), self.log.offset, None, now)?;
                }
            }
        }
        Ok(())
    }

    /// The user picked a log file (already validated) or cleared it (`None`).
    pub fn set_manual_log(&mut self, path: Option<PathBuf>) -> AppResult<()> {
        let now = (self.now)();
        store::set_log_path(&*self.db.conn()?, self.game, path.as_deref().map(|p| p.to_string_lossy()).as_deref(), now)?;
        self.log = LogRuntime { lines_read: self.log.lines_read, events_parsed: self.log.events_parsed, parse_errors: self.log.parse_errors, ..Default::default() };
        self.resolve_log();
        if self.session.is_some() {
            if let Some(proc_started) = self.process.as_ref().map(|p| p.started_at) {
                self.position_reader(proc_started, now)?;
            }
        }
        self.next_scan_at = 0;
        Ok(())
    }

    // ---------- tick ----------

    pub fn tick(&mut self) -> TickOutcome {
        let mut out = TickOutcome::default();
        let now = (self.now)();
        if self.config.auto_detect && now >= self.next_scan_at {
            self.next_scan_at = now + self.config.poll_secs as i64;
            match self.scan(now) {
                Ok(completed) => {
                    out.completed = completed;
                    out.changed |= completed.is_some();
                }
                Err(e) => self.fail(format!("{e}")),
            }
        }
        if self.session.is_some() && !self.paused && self.config.auto_track {
            match self.read_log(now, false) {
                Ok(n) => out.changed |= n > 0,
                Err(e) => self.fail(format!("{e}")),
            }
            out.more_pending = self.log.backlog > 0 && self.log.error.is_none();
        }
        let st = (self.state(), self.message());
        if self.last_state.as_ref() != Some(&st) {
            self.last_state = Some(st);
            out.changed = true;
        }
        out
    }

    fn fail(&mut self, e: String) {
        log::warn!("session tracker: {e}");
        self.last_error = Some(e);
    }

    fn scan(&mut self, now: i64) -> AppResult<Option<i64>> {
        let t0 = std::time::Instant::now();
        let scanned = self.procs.scan();
        self.scans += 1;
        self.last_scan_at = Some(now);
        self.last_scan_ms = Some(t0.elapsed().as_millis() as u64);
        let list = match scanned {
            Ok(l) => {
                self.scan_error = None;
                l
            }
            Err(e) => {
                self.scan_error = Some(e.clone());
                self.last_error = Some(e);
                return Ok(None);
            }
        };
        // Find Client.txt even while the game is closed (cheap file checks, at most once a minute).
        if self.log.path.is_none() && now - self.last_resolve_at >= 60 {
            self.last_resolve_at = now;
            self.resolve_log();
        }
        let found = pick_poe2(&list, self.log.path.as_deref());
        let first = !self.first_scan_done;
        self.first_scan_done = true;
        let mut completed = None;

        if first {
            self.recover(found.as_ref(), now)?;
        }
        // The tracked client went away (or was replaced by another run).
        if let Some(s) = self.session.clone() {
            let same = found.as_ref().is_some_and(|p| Some(p.pid) == s.process_id);
            if same {
                self.last_seen_running = now;
            } else {
                completed = self.finish_session(now)?;
            }
        }
        if let Some(p) = &found {
            if self.session.is_none() {
                let skipped = self.skipped.is_some_and(|(pid, st)| pid == p.pid && st == p.started_at);
                if first && !self.config.attach_to_running {
                    self.skipped = Some((p.pid, p.started_at));
                } else if !skipped && self.config.auto_track {
                    self.start_session(p, now)?;
                    completed = None;
                }
            }
        } else {
            self.skipped = None;
        }
        self.process = found;
        Ok(completed)
    }

    /// First scan after start: resume or close a session left active by a previous run of Vaalytics.
    fn recover(&mut self, found: Option<&ProcInfo>, now: i64) -> AppResult<()> {
        let active = store::active_session(&*self.db.conn()?, self.game)?;
        let Some(a) = active else { return Ok(()) };
        let same = found.is_some_and(|p| Some(p.pid) == a.process_id && a.process_started_at.is_some_and(|t| (t - p.started_at).abs() <= 2));
        self.resolve_log();
        self.restore_position();
        self.open_visit = store::open_visit(&*self.db.conn()?, a.id)?.map(|v| (v.id, v.area_name.is_none()));
        self.session = Some(a.clone());
        if same {
            self.last_seen_running = now;
            store::insert_event(&*self.db.conn()?, self.game, a.id, now, "tracking_resumed", None, None)?;
            log::info!("session {}: resumed after a Vaalytics restart", a.id);
        } else {
            // Catch up with lines the crashed run didn't read, then close at the last activity.
            if self.config.auto_track && !self.paused {
                for _ in 0..(MAX_CATCH_UP_BYTES as usize / (CHUNK_BYTES * MAX_CHUNKS_PER_TICK)) {
                    let before = self.log.offset;
                    self.read_log(now, true)?;
                    if self.log.backlog == 0 || self.log.offset == before {
                        break;
                    }
                }
            }
            let s = store::get_session(&*self.db.conn()?, self.game, a.id)?.unwrap_or(a);
            let end = s.last_activity_at;
            {
                let mut c = self.db.conn()?;
                let tx = c.transaction()?;
                store::insert_event(&tx, self.game, s.id, end, "recovered", Some("Vaalytics wasn't running when the game closed; ended at the last recorded activity."), None)?;
                store::finish(&tx, s.id, end, "recovered")?;
                tx.commit()?;
            }
            log::info!("session {}: closed after recovery", s.id);
            self.session = None;
            self.open_visit = None;
            self.after_completion(s.id, now)?;
        }
        Ok(())
    }

    fn start_session(&mut self, p: &ProcInfo, now: i64) -> AppResult<()> {
        self.resolve_log();
        let started = p.started_at.min(now).max(0);
        let id = {
            let mut c = self.db.conn()?;
            let tx = c.transaction()?;
            let id = store::create_session(&tx, self.game, started, Some(p.pid), Some(p.started_at), false, now)?;
            store::insert_event(&tx, self.game, id, started, "game_started", None, None)?;
            tx.commit()?;
            id
        };
        self.session = store::get_session(&*self.db.conn()?, self.game, id)?;
        self.open_visit = None;
        self.last_seen_running = now;
        self.last_completed = None;
        self.position_reader(p.started_at, now)?;
        log::info!("session {id}: started (game process detected)");
        Ok(())
    }

    fn finish_session(&mut self, now: i64) -> AppResult<Option<i64>> {
        let Some(s) = self.session.clone() else { return Ok(None) };
        if !self.paused && self.config.auto_track {
            for _ in 0..8 {
                let before = self.log.offset;
                self.read_log(now, false)?;
                if self.log.backlog == 0 || self.log.offset == before {
                    break;
                }
            }
        }
        let fresh = store::get_session(&*self.db.conn()?, self.game, s.id)?.unwrap_or(s);
        let end = self.last_seen_running.max(fresh.last_activity_at).min(now).max(fresh.started_at);
        {
            let mut c = self.db.conn()?;
            let tx = c.transaction()?;
            store::insert_event(&tx, self.game, fresh.id, end, "game_closed", None, None)?;
            store::finish(&tx, fresh.id, end, "game_closed")?;
            tx.commit()?;
        }
        self.session = None;
        self.open_visit = None;
        log::info!("session {}: completed (game closed)", fresh.id);
        Ok(self.after_completion(fresh.id, now)?.then_some(fresh.id))
    }

    /// Short-session rule and retention. Returns false when the session was dropped.
    fn after_completion(&mut self, id: i64, now: i64) -> AppResult<bool> {
        let c = self.db.conn()?;
        let mut kept = true;
        if !self.config.keep_short_sessions {
            if let Some(s) = store::get_session(&c, self.game, id)? {
                if s.duration_secs < SHORT_SESSION_SECS && s.maps_entered == 0 {
                    store::delete(&c, self.game, &[id])?;
                    kept = false;
                    log::info!("session {id}: dropped (shorter than {SHORT_SESSION_SECS}s, no maps)");
                }
            }
        }
        store::apply_retention(&c, self.game, self.config.retention_days, now)?;
        self.last_completed = if kept { Some(id) } else { self.last_completed };
        Ok(kept)
    }

    // ---------- log ----------

    fn resolve_log(&mut self) {
        let manual = self.db.conn().ok().and_then(|c| store::tracker_state(&c, self.game).ok()).and_then(|s| s.log_path);
        if let Some(m) = manual {
            let p = PathBuf::from(m);
            self.log.manual = true;
            self.log.check = discover::validate(&p).ok();
            self.log.error = if p.is_file() { None } else { Some("The selected Client.txt can't be found.".into()) };
            self.log.path = Some(p);
            return;
        }
        self.log.manual = false;
        if self.log.path.as_ref().is_some_and(|p| p.is_file()) {
            return;
        }
        if !self.config.auto_discover {
            self.log.path = None;
            self.log.error = Some("Client.txt isn't set. Choose it in Settings, or turn on auto-discovery.".into());
            return;
        }
        match (self.discover)(self.process.as_ref()) {
            Some(p) => {
                self.log.check = discover::validate(&p).ok();
                self.log.path = Some(p);
                self.log.error = None;
            }
            None => {
                self.log.path = None;
                self.log.error = Some("Client.txt wasn't found automatically. Choose it in Settings.".into());
            }
        }
    }

    fn restore_position(&mut self) {
        if let Ok(st) = self.db.conn().and_then(|c| store::tracker_state(&c, self.game)) {
            self.log.key = st.log_key;
            self.log.offset = st.log_offset;
            self.log.last_line_at = st.last_line_at;
        }
    }

    /// Chooses where to start reading for a client started at `proc_started`:
    /// the stored position when it is on the same file and close enough,
    /// otherwise the last `LOG FILE OPENING` of this run, otherwise the end.
    fn position_reader(&mut self, proc_started: i64, now: i64) -> AppResult<()> {
        self.restore_position();
        let Some(path) = self.log.path.clone() else { return Ok(()) };
        let probe = match reader::probe(&path) {
            Ok(p) => p,
            Err(e) => {
                self.log.error = Some(format!("Client.txt can't be read ({}).", e.kind()));
                return Ok(());
            }
        };
        let same_file = self.log.key.is_some() && self.log.key == probe.key && self.log.offset <= probe.size;
        if !(same_file && probe.size - self.log.offset <= MAX_CATCH_UP_BYTES) {
            let start = reader::last_client_start(&path, START_SEARCH_WINDOW)?
                .and_then(|(off, line)| log_format::parse_stamp(&line).and_then(self.to_unix).map(|t| (off, t)))
                .filter(|(_, t)| *t >= proc_started - 180);
            self.log.offset = start.map(|(o, _)| o).unwrap_or(probe.size);
            self.log.key = probe.key;
            store::save_position(&*self.db.conn()?, self.game, self.log.key.as_deref(), self.log.offset, None, now)?;
        }
        Ok(())
    }

    /// Reads up to a few chunks and applies them. Returns the number of events applied.
    /// In `recovery` mode, stops at the first line written by a different client run.
    fn read_log(&mut self, now: i64, recovery: bool) -> AppResult<u64> {
        let Some(session) = self.session.clone() else { return Ok(0) };
        if self.log.path.as_ref().is_none_or(|p| !p.is_file()) {
            self.resolve_log();
            if self.log.path.is_some() && self.log.error.is_none() {
                self.restore_position();
                if self.log.key.is_none() {
                    self.position_reader(session.process_started_at.unwrap_or(session.started_at), now)?;
                }
            }
        }
        let Some(path) = self.log.path.clone() else { return Ok(0) };
        let mut applied = 0u64;
        for _ in 0..MAX_CHUNKS_PER_TICK {
            let chunk = match reader::read_from(&path, self.log.key.as_deref(), self.log.offset, CHUNK_BYTES) {
                Ok(c) => c,
                Err(e) => {
                    self.log.error = Some(if e.kind() == std::io::ErrorKind::NotFound {
                        "Client.txt is missing — waiting for it to come back.".into()
                    } else {
                        format!("Client.txt can't be read ({}) — retrying.", e.kind())
                    });
                    return Ok(applied);
                }
            };
            self.log.error = None;
            self.log.last_read_at = Some(now);
            self.log.size = chunk.size;
            self.log.skipped_long_lines += chunk.skipped_long_lines as u64;
            self.log.parse_errors += chunk.skipped_long_lines as u64;
            let (n, stop_offset) = self.apply_chunk(&session, &chunk, now, recovery)?;
            applied += n;
            if stop_offset.is_some() || chunk.remaining == 0 || chunk.lines.is_empty() && chunk.reset.is_none() {
                break;
            }
        }
        Ok(applied)
    }

    fn apply_chunk(&mut self, session: &SessionSummary, chunk: &reader::Chunk, now: i64, recovery: bool) -> AppResult<(u64, Option<u64>)> {
        // Nothing new: keep the session's last activity fresh without a write every tick.
        if chunk.lines.is_empty() && chunk.reset.is_none() && chunk.key == self.log.key && chunk.offset == self.log.offset {
            self.log.backlog = chunk.remaining;
            if !recovery && (now - self.last_touch >= 30 || !session.log_tracked) {
                let c = self.db.conn()?;
                store::touch(&c, session.id, now.min(self.last_seen_running.max(session.started_at)))?;
                if !session.log_tracked {
                    store::set_log_tracked(&c, session.id)?;
                }
                self.last_touch = now;
                self.session = store::get_session(&c, self.game, session.id)?;
            }
            return Ok((0, None));
        }
        let key = chunk.key.clone().unwrap_or_else(|| "pending".into());
        let mut applied = 0u64;
        let mut stop_at: Option<u64> = None;
        let mut last_at: Option<i64> = None;
        let db = Arc::clone(&self.db);
        let mut c = db.conn()?;
        let tx = c.transaction()?;
        if !session.log_tracked {
            store::set_log_tracked(&tx, session.id)?;
        }
        if let Some(r) = chunk.reset {
            self.log.resets += 1;
            let detail = match r {
                Reset::Truncated => "Client.txt was truncated; reading from the start.",
                Reset::Replaced => "Client.txt was replaced; reading the new file from the start.",
            };
            store::insert_event(&tx, self.game, session.id, now, "log_reset", Some(detail), None)?;
            self.open_visit = None;
        }
        for (off, line) in &chunk.lines {
            self.log.lines_read += 1;
            let parsed = match log_format::parse_line(line) {
                LineResult::Event(p) => p,
                LineResult::Ignored => continue,
                LineResult::Malformed => {
                    self.log.parse_errors += 1;
                    continue;
                }
            };
            let Some(at) = (self.to_unix)(parsed.at) else {
                self.log.parse_errors += 1;
                continue;
            };
            if at < session.started_at - START_MARGIN_SECS {
                continue; // an earlier run
            }
            if let (Some(cid), Some(pid)) = (parsed.client_id, session.process_id) {
                if cid != pid {
                    if recovery {
                        stop_at = Some(*off);
                        break;
                    }
                    continue;
                }
            }
            if recovery && parsed.event == LogEvent::ClientStart && at > session.started_at + START_MARGIN_SECS {
                stop_at = Some(*off);
                break;
            }
            self.log.events_parsed += 1;
            if self.apply_event(&tx, session.id, &parsed.event, at, &key, *off)? {
                applied += 1;
            }
            last_at = Some(at);
        }
        let new_offset = stop_at.unwrap_or(chunk.offset);
        if let Some(at) = last_at {
            store::touch(&tx, session.id, at)?;
            self.log.last_line_at = Some(at);
        }
        if !recovery {
            store::touch(&tx, session.id, now.min(self.last_seen_running.max(session.started_at)))?;
        }
        store::save_position(&tx, self.game, chunk.key.as_deref(), new_offset, last_at, now)?;
        store::recompute(&tx, session.id)?;
        tx.commit()?;
        self.last_touch = now;
        self.log.key = chunk.key.clone();
        self.log.offset = new_offset;
        self.log.backlog = if stop_at.is_some() { 0 } else { chunk.remaining };
        self.session = store::get_session(&c, self.game, session.id)?;
        Ok((applied, stop_at))
    }

    fn apply_event(&mut self, c: &rusqlite::Connection, sid: i64, ev: &LogEvent, at: i64, key: &str, off: u64) -> AppResult<bool> {
        if self.config.debug_logging {
            log::info!("session {sid}: {ev:?} at {at}");
        }
        let pos = Some((key, off));
        // Campaign Intelligence reads the same line in the same transaction. Its
        // failure must not stop session tracking (a failed statement rolls back alone).
        let campaign = match self.campaign.on_event(c, ev, at, key, off) {
            Ok(changed) => changed,
            Err(e) => {
                log::warn!("campaign: {e}");
                false
            }
        };
        let session = match ev {
            LogEvent::ClientStart => store::insert_event(c, self.game, sid, at, "client_log_opened", None, pos)?,
            LogEvent::AreaGenerated { level, area_id, seed } => {
                let kind = areas::classify(area_id);
                match store::enter_area(c, self.game, sid, &NewVisit { area_id, area_level: *level, seed: *seed, kind: kind.as_str(), at, log_key: key, log_offset: off })? {
                    Some(id) => {
                        self.open_visit = Some((id, true));
                        true
                    }
                    None => false,
                }
            }
            LogEvent::SceneName(name) => {
                // `Atlas` is the map-device/atlas screen, not an area.
                if let (Some((id, true)), false) = (self.open_visit, name == "Atlas") {
                    store::name_visit(c, id, name)?;
                    self.open_visit = Some((id, false));
                }
                false
            }
            LogEvent::LoadingScreen { name, secs } => {
                if let Some((id, needs_name)) = self.open_visit {
                    store::set_visit_loading(c, id, *secs)?;
                    if needs_name {
                        store::name_visit(c, id, name)?;
                        self.open_visit = Some((id, false));
                    }
                }
                false
            }
            LogEvent::Slain { .. } => store::insert_event(c, self.game, sid, at, "death", None, pos)?,
            LogEvent::LevelUp { level, .. } => store::insert_event(c, self.game, sid, at, "level_up", Some(&format!("Level {level}")), pos)?,
            LogEvent::AfkOn => store::insert_event(c, self.game, sid, at, "afk_on", None, pos)?,
            LogEvent::AfkOff => store::insert_event(c, self.game, sid, at, "afk_off", None, pos)?,
            LogEvent::AbnormalDisconnect => store::insert_event(c, self.game, sid, at, "disconnect", None, pos)?,
            // Used by Campaign Intelligence only.
            LogEvent::ClientVersion { .. }
            | LogEvent::LoginConnect
            | LogEvent::PassivePoints { .. }
            | LogEvent::PlayerJoined { .. }
            | LogEvent::PlayerLeft { .. } => false,
        };
        Ok(session || campaign)
    }

    // ---------- status ----------

    pub fn state(&self) -> TrackState {
        if !self.config.auto_detect {
            return TrackState::Paused;
        }
        if self.scan_error.is_some() {
            return TrackState::Error;
        }
        if self.session.is_some() {
            if self.paused {
                return TrackState::Paused;
            }
            if self.log.path.is_none() {
                return TrackState::Error;
            }
            if self.log.error.is_some() {
                return TrackState::Reconnecting;
            }
            if self.log.backlog > 512 * 1024 {
                return TrackState::ReadingLog;
            }
            return TrackState::Tracking;
        }
        if self.process.is_some() {
            return TrackState::Detected;
        }
        if self.last_completed.is_some() {
            return TrackState::Completed;
        }
        TrackState::NotDetected
    }

    pub fn message(&self) -> Option<String> {
        if !self.config.auto_detect {
            return Some("Automatic game detection is off (Settings).".into());
        }
        if let Some(e) = &self.scan_error {
            return Some(e.clone());
        }
        if self.session.is_some() {
            if self.paused {
                return Some("Tracking is paused — Client.txt isn't read until you resume.".into());
            }
            if let Some(e) = &self.log.error {
                return Some(format!("{e} Session time is still recorded."));
            }
            return None;
        }
        if self.process.is_some() {
            if self.skipped.is_some() {
                return Some("The game was already running when Vaalytics started; tracking starts with the next launch (Settings → Start when the game is already running).".into());
            }
            if !self.config.auto_track {
                return Some("Automatic tracking is off (Settings).".into());
            }
        }
        None
    }

    pub fn status(&self) -> AppResult<Status> {
        let c = self.db.conn()?;
        let active = match &self.session {
            Some(s) => store::get_session(&c, self.game, s.id)?,
            None => None,
        };
        let current_area = match &active {
            Some(s) => store::last_visit(&c, s.id)?,
            None => None,
        };
        Ok(Status {
            state: self.state(),
            message: self.message(),
            paused: self.paused,
            process: self.process.as_ref().map(|p| ProcStatus { pid: p.pid, started_at: p.started_at }),
            active_session: active,
            current_area,
            last_completed_id: self.last_completed,
            log: LogStatus {
                found: self.log.path.as_ref().is_some_and(|p| p.is_file()),
                label: self.log.path.as_deref().map(discover::masked),
                manual: self.log.manual,
                confirmed_poe2: self.log.check == Some(LogCheck::Poe2),
                error: self.log.error.clone(),
            },
            config: self.config.clone(),
        })
    }

    pub fn diagnostics(&mut self) -> Diagnostics {
        if self.log.path.is_none() {
            self.resolve_log();
        }
        let path = self.log.path.clone();
        let exists = path.as_deref().is_some_and(Path::is_file);
        Diagnostics {
            state: self.state(),
            message: self.message(),
            process_name: self.process.as_ref().map(|p| p.name.clone()),
            process_id: self.process.as_ref().map(|p| p.pid),
            process_started_at: self.process.as_ref().map(|p| p.started_at),
            log_path: path.as_deref().map(|p| p.to_string_lossy().into_owned()),
            log_manual: self.log.manual,
            log_exists: exists,
            log_check: path.as_deref().map(|p| match discover::validate(p) {
                Ok(LogCheck::Poe2) => "PoE 2 log".to_string(),
                Ok(LogCheck::Unconfirmed) => "Client log (no PoE 2 signature yet)".to_string(),
                Err(e) => e,
            }),
            log_size: path.as_deref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0),
            offset: self.log.offset,
            backlog_bytes: self.log.backlog,
            file_key: self.log.key.clone(),
            last_read_at: self.log.last_read_at,
            last_line_at: self.log.last_line_at,
            lines_read: self.log.lines_read,
            events_parsed: self.log.events_parsed,
            parse_errors: self.log.parse_errors,
            skipped_long_lines: self.log.skipped_long_lines,
            log_resets: self.log.resets,
            last_error: self.last_error.clone().or_else(|| self.log.error.clone()),
            session_id: self.session.as_ref().map(|s| s.id),
            poll_secs: self.config.poll_secs,
            scans: self.scans,
            last_scan_at: self.last_scan_at,
            last_scan_ms: self.last_scan_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Mutex;

    /// Process list the test controls.
    #[derive(Clone)]
    struct FakeProcs(Arc<Mutex<Result<Vec<ProcInfo>, String>>>);
    impl Default for FakeProcs {
        fn default() -> Self {
            Self(Arc::new(Mutex::new(Ok(Vec::new()))))
        }
    }
    impl FakeProcs {
        fn set(&self, v: Vec<ProcInfo>) {
            *self.0.lock().unwrap() = Ok(v);
        }
        fn fail(&self) {
            *self.0.lock().unwrap() = Err("process list unavailable".into());
        }
    }
    impl ProcessSource for FakeProcs {
        fn scan(&mut self) -> Result<Vec<ProcInfo>, String> {
            self.0.lock().unwrap().clone()
        }
    }

    fn poe2(pid: u32, started_at: i64) -> ProcInfo {
        ProcInfo { pid, name: "PathOfExileSteam.exe".into(), exe: None, started_at, window_game: Some(GameId::Poe2) }
    }

    /// Log time = UTC in tests (deterministic).
    fn utc(s: LocalStamp) -> Option<i64> {
        Some(super::super::localtime::as_utc(s))
    }

    fn stamp(t: i64) -> String {
        let days = t.div_euclid(86_400);
        let secs = t.rem_euclid(86_400);
        // civil_from_days (Hinnant)
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
        format!("{y:04}/{m:02}/{d:02} {:02}:{:02}:{:02}", secs / 3600, secs % 3600 / 60, secs % 60)
    }

    struct Rig {
        tracker: Tracker,
        procs: FakeProcs,
        clock: Arc<AtomicI64>,
        db: Arc<Database>,
        log: PathBuf,
        _dir: tempfile::TempDir,
    }

    const T0: i64 = 1_794_924_000;

    impl Rig {
        fn new() -> Self {
            Self::with_db(Arc::new(Database::open_in_memory().unwrap()), None)
        }
        fn with_db(db: Arc<Database>, dir: Option<tempfile::TempDir>) -> Self {
            let dir = dir.unwrap_or_else(|| tempfile::tempdir().unwrap());
            let log = dir.path().join("Client.txt");
            if !log.exists() {
                std::fs::write(&log, "").unwrap();
            }
            let procs = FakeProcs::default();
            procs.set(vec![]);
            let clock = Arc::new(AtomicI64::new(T0));
            let ck = Arc::clone(&clock);
            let lp = log.clone();
            let mut tracker = Tracker::new(GameId::Poe2, Arc::clone(&db), Box::new(procs.clone()), Box::new(move || ck.load(Ordering::SeqCst)), utc, Box::new(move |_| Some(lp.clone())));
            tracker.set_config(Config { poll_secs: 5, ..Config::default() });
            Self { tracker, procs, clock, db, log, _dir: dir }
        }
        fn at(&self, t: i64) {
            self.clock.store(t, Ordering::SeqCst);
        }
        fn write(&self, lines: &[(i64, &str)]) {
            let mut f = std::fs::OpenOptions::new().append(true).open(&self.log).unwrap();
            for (t, body) in lines {
                writeln!(f, "{} {}", stamp(*t), body).unwrap();
            }
        }
        fn tick_at(&mut self, t: i64) -> TickOutcome {
            self.at(t);
            self.tracker.next_scan_at = 0;
            self.tracker.tick()
        }
        fn sessions(&self) -> Vec<SessionSummary> {
            store::list(&self.db.conn().unwrap(), GameId::Poe2, &store::HistoryQuery { sort: Some("oldest".into()), ..Default::default() }).unwrap()
        }
    }

    fn area(pid: u32, id: &str, seed: u64) -> String {
        format!("1 2caa22f9 [DEBUG Client {pid}] Generating level 79 area \"{id}\" with seed {seed}")
    }
    fn scene(pid: u32, name: &str) -> String {
        format!("1 7fbd1225 [INFO Client {pid}] [SCENE] Set Source [{name}]")
    }
    const OPEN: &str = "***** LOG FILE OPENING *****";

    #[test]
    fn full_session_lifecycle_with_maps_and_no_duplicates() {
        let mut r = Rig::new();
        // An older run in the log must be ignored.
        r.write(&[(T0 - 7200, OPEN), (T0 - 7190, &area(11, "MapOld", 5))]);
        assert_eq!(r.tick_at(T0).completed, None);
        assert_eq!(r.tracker.state(), TrackState::NotDetected);

        r.procs.set(vec![poe2(40, T0 + 10)]);
        r.write(&[(T0 + 10, OPEN), (T0 + 30, &area(40, "HideoutShrine", 1)), (T0 + 31, &scene(40, "(null)")), (T0 + 31, &scene(40, "Shrine Hideout"))]);
        r.tick_at(T0 + 35);
        assert_eq!(r.tracker.state(), TrackState::Tracking);
        let st = r.tracker.status().unwrap();
        assert_eq!(st.current_area.as_ref().unwrap().area_name.as_deref(), Some("Shrine Hideout"));
        assert_eq!(st.current_area.unwrap().kind, "hideout");

        r.write(&[
            (T0 + 100, &scene(40, "Atlas")),
            (T0 + 120, &area(40, "MapRazedFields", 77)),
            (T0 + 121, &scene(40, "Razed Fields")),
            (T0 + 125, &format!("1 4cba6a95 [INFO Client 40] [LOADING SCREEN] (Razed Fields) Duration = 4.5 seconds")),
            (T0 + 300, &format!("1 3ef [INFO Client 40] : Someone has been slain.")),
            (T0 + 400, &area(40, "HideoutShrine", 1)),
            (T0 + 450, &area(40, "MapRazedFields", 77)),
            (T0 + 500, &area(40, "G1_town", 1)),
            (T0 + 560, &area(40, "MapVaalFactory", 9)),
        ]);
        r.tick_at(T0 + 600);
        r.tick_at(T0 + 605); // nothing new: no duplicates
        r.procs.set(vec![]);
        let out = r.tick_at(T0 + 700);
        let id = out.completed.expect("completed on game exit");
        assert_eq!(r.tracker.state(), TrackState::Completed);

        let s = r.sessions();
        assert_eq!(s.len(), 1);
        let s = &s[0];
        assert_eq!(s.id, id);
        assert_eq!(s.started_at, T0 + 10);
        assert_eq!(s.ended_at, Some(T0 + 605), "last time the process was seen");
        assert_eq!(s.maps_entered, 2, "Razed Fields twice (same seed) + Vaal Factory");
        assert_eq!(s.areas_entered, 6);
        assert_eq!(s.deaths, 1);
        assert_eq!(s.town_secs, 60);
        assert_eq!(s.map_secs, (400 - 120) + (500 - 450) + (605 - 560));
        assert!(s.log_tracked);
        let d = store::detail(&r.db.conn().unwrap(), GameId::Poe2, id).unwrap().unwrap();
        assert_eq!(d.visits[1].area_name.as_deref(), Some("Razed Fields"));
        assert_eq!(d.visits[1].loading_secs, Some(4.5));
        assert_eq!(d.visits[0].area_name.as_deref(), Some("Shrine Hideout"), "Atlas screen doesn't rename");
        assert!(d.map_runs.iter().all(|m| m.completed.is_none()));
    }

    #[test]
    fn campaign_events_come_from_the_same_reader() {
        let mut r = Rig::new();
        r.procs.set(vec![poe2(40, T0 + 10)]);
        r.write(&[
            (T0 + 10, OPEN),
            (T0 + 11, "1 a [INFO Client 40] [HTTP2] User agent: PoE poe2_production/tags/0.5.5g Windows x64"),
            (T0 + 20, &area(40, "G1_11", 1)),
            (T0 + 21, &scene(40, "Hunting Grounds")),
            (T0 + 30, "1 a [INFO Client 40] : Exile_One (Monk) is now level 10"),
            (T0 + 40, "1 a [INFO Client 40] : You have received 2 Passive Skill Points."),
            (T0 + 40, "1 a [INFO Client 40] : You have received 2 Weapon Set Passive Skill Points."),
        ]);
        r.tick_at(T0 + 50);
        r.tick_at(T0 + 55); // re-read nothing new
        let c = r.db.conn().unwrap();
        let ch = crate::campaign::store::characters(&c, GameId::Poe2).unwrap();
        assert_eq!(ch.len(), 1);
        let ev = crate::campaign::store::events(&c, GameId::Poe2, ch[0].id).unwrap();
        let kinds: Vec<_> = ev.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["zone", "level", "passive_points", "weapon_set_points"]);
        assert_eq!(ev[0].area_name.as_deref(), Some("Hunting Grounds"));
        assert_eq!(crate::campaign::store::status(&c, GameId::Poe2).unwrap().client_tag.as_deref(), Some("0.5.5g"));
    }

    #[test]
    fn short_sessions_are_dropped_unless_kept() {
        let mut r = Rig::new();
        r.tick_at(T0);
        r.procs.set(vec![poe2(8, T0 + 5)]);
        r.tick_at(T0 + 10);
        r.procs.set(vec![]);
        assert_eq!(r.tick_at(T0 + 30).completed, None);
        assert!(r.sessions().is_empty());

        r.tracker.set_config(Config { keep_short_sessions: true, ..Config::default() });
        r.procs.set(vec![poe2(12, T0 + 40)]);
        r.tick_at(T0 + 45);
        r.procs.set(vec![]);
        assert!(r.tick_at(T0 + 60).completed.is_some());
        assert_eq!(r.sessions().len(), 1);
    }

    #[test]
    fn resumes_after_vaalytics_restart_while_game_runs() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let dir = tempfile::tempdir().unwrap();
        let mut r = Rig::with_db(Arc::clone(&db), Some(dir));
        r.tick_at(T0);
        r.procs.set(vec![poe2(40, T0 + 10)]);
        r.write(&[(T0 + 10, OPEN), (T0 + 20, &area(40, "MapA", 3))]);
        r.tick_at(T0 + 25);
        // Vaalytics "crashes": a new tracker on the same DB and log.
        let dir = std::mem::replace(&mut r._dir, tempfile::tempdir().unwrap());
        drop(r.tracker);
        let mut r2 = Rig::with_db(Arc::clone(&db), Some(dir));
        r2.write(&[(T0 + 40, &area(40, "HideoutShrine", 1))]);
        r2.procs.set(vec![poe2(40, T0 + 10)]);
        r2.tick_at(T0 + 50);
        assert_eq!(r2.tracker.state(), TrackState::Tracking);
        let s = r2.sessions();
        assert_eq!(s.len(), 1, "same session continued, no duplicate");
        assert_eq!(s[0].areas_entered, 2, "the map wasn't recorded twice");
        r2.procs.set(vec![]);
        assert!(r2.tick_at(T0 + 400).completed.is_some());
        assert_eq!(r2.sessions()[0].maps_entered, 1);
    }

    #[test]
    fn closes_a_session_left_active_after_a_crash_and_catches_up() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let mut r = Rig::with_db(Arc::clone(&db), None);
        r.tick_at(T0);
        r.procs.set(vec![poe2(40, T0 + 10)]);
        r.write(&[(T0 + 10, OPEN), (T0 + 20, &area(40, "HideoutShrine", 1))]);
        r.tick_at(T0 + 25);
        // Vaalytics dies; the game keeps writing, closes, and a new client run starts.
        r.write(&[(T0 + 200, &area(40, "MapB", 4)), (T0 + 500, &area(40, "HideoutShrine", 1)), (T0 + 900, OPEN), (T0 + 905, &area(52, "HideoutShrine", 1))]);
        let dir = std::mem::replace(&mut r._dir, tempfile::tempdir().unwrap());
        drop(r.tracker);
        let mut r2 = Rig::with_db(Arc::clone(&db), Some(dir));
        r2.procs.set(vec![poe2(52, T0 + 900)]);
        r2.tick_at(T0 + 910);
        let s = r2.sessions();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].end_reason.as_deref(), Some("recovered"));
        assert_eq!(s[0].ended_at, Some(T0 + 500), "ends at the last line of its own run");
        assert_eq!(s[0].maps_entered, 1, "caught up with lines written while Vaalytics was down");
        assert_eq!(s[1].status, "active");
        assert_eq!(s[1].areas_entered, 1, "new run's lines go to the new session");
    }

    #[test]
    fn game_already_running_respects_the_attach_setting() {
        let mut r = Rig::new();
        r.tracker.set_config(Config { attach_to_running: false, ..Config::default() });
        r.procs.set(vec![poe2(40, T0 - 100)]);
        r.tick_at(T0);
        assert_eq!(r.tracker.state(), TrackState::Detected);
        assert!(r.tracker.message().unwrap().contains("already running"));
        r.tick_at(T0 + 10);
        assert!(r.sessions().is_empty());
        // Next launch is tracked.
        r.procs.set(vec![]);
        r.tick_at(T0 + 20);
        r.procs.set(vec![poe2(44, T0 + 25)]);
        r.tick_at(T0 + 30);
        assert_eq!(r.tracker.state(), TrackState::Tracking);
    }

    #[test]
    fn attaching_to_a_running_game_reads_its_run_from_the_start() {
        let mut r = Rig::new();
        r.write(&[(T0 - 3000, OPEN), (T0 - 2990, &area(9, "MapOld", 1)), (T0 - 100, OPEN), (T0 - 90, &area(40, "MapRiverside", 5))]);
        r.procs.set(vec![poe2(40, T0 - 100)]);
        r.tick_at(T0);
        let s = &r.sessions()[0];
        assert_eq!(s.maps_entered, 1, "only the current run");
        assert_eq!(s.started_at, T0 - 100);
    }

    #[test]
    fn missing_log_then_reconnect_and_truncation() {
        let mut r = Rig::new();
        r.tick_at(T0);
        std::fs::remove_file(&r.log).unwrap();
        r.procs.set(vec![poe2(40, T0 + 5)]);
        r.tick_at(T0 + 10);
        assert!(matches!(r.tracker.state(), TrackState::Reconnecting | TrackState::Error));
        assert!(!r.sessions()[0].log_tracked);
        std::fs::write(&r.log, "").unwrap();
        r.write(&[(T0 + 12, OPEN), (T0 + 20, &area(40, "MapA", 1))]);
        r.tick_at(T0 + 25);
        assert_eq!(r.tracker.state(), TrackState::Tracking);
        assert!(r.sessions()[0].log_tracked);
        assert_eq!(r.sessions()[0].maps_entered, 1);
        // Replaced by a shorter file → read from the start.
        std::fs::write(&r.log, "").unwrap();
        r.write(&[(T0 + 30, &area(40, "MapB", 2))]);
        r.tick_at(T0 + 35);
        let s = &r.sessions()[0];
        assert_eq!(s.maps_entered, 2);
    }

    #[test]
    fn pause_skips_lines_and_scan_errors_surface() {
        let mut r = Rig::new();
        r.procs.set(vec![poe2(40, T0)]);
        r.write(&[(T0, OPEN)]);
        r.tick_at(T0 + 5);
        r.tracker.set_paused(true).unwrap();
        r.write(&[(T0 + 10, &area(40, "MapA", 1))]);
        r.tick_at(T0 + 15);
        assert_eq!(r.tracker.state(), TrackState::Paused);
        r.tracker.set_paused(false).unwrap();
        r.write(&[(T0 + 20, &area(40, "MapB", 2))]);
        r.tick_at(T0 + 25);
        assert_eq!(r.sessions()[0].maps_entered, 1, "MapA was written while paused");
        r.procs.fail();
        r.tick_at(T0 + 30);
        assert_eq!(r.tracker.state(), TrackState::Error);
        let d = r.tracker.diagnostics();
        assert_eq!(d.last_error.as_deref(), Some("process list unavailable"));
        assert!(d.lines_read >= 2);
    }

    #[test]
    fn foreign_client_lines_are_ignored_while_live() {
        let mut r = Rig::new();
        r.procs.set(vec![poe2(40, T0)]);
        r.write(&[(T0, OPEN), (T0 + 5, &area(99, "MapOther", 1)), (T0 + 6, &area(40, "MapMine", 1))]);
        r.tick_at(T0 + 10);
        assert_eq!(r.sessions()[0].maps_entered, 1);
    }
}
