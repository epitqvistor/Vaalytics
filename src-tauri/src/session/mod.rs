//! Session Intelligence: automatic Path of Exile 2 session tracking.
//! Spec: docs/modules/session-intelligence.md
//!
//! One application-level background thread owns the `Tracker`. It checks the
//! process list every `poll_secs` (default 5 s) and, only while the game runs,
//! reads new lines of Client.txt every 2 s. Changes reach the UI as debounced
//! `session:updated` events; nothing polls while the game isn't running except
//! the cheap process check. Observation only: no memory reading, injection or
//! game-file changes.

pub mod areas;
pub mod discover;
pub mod export;
pub mod localtime;
pub mod log_format;
pub mod process;
pub mod reader;
pub mod store;
pub mod tracker;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::settings;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tracker::{Config, Diagnostics, Status, Tracker};

pub const EVENT_UPDATED: &str = "session:updated";
pub const EVENT_COMPLETED: &str = "session:completed";
const LIVE_READ_INTERVAL: Duration = Duration::from_secs(2);
const MIN_EMIT_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatedEvent {
    game: GameId,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletedEvent {
    game: GameId,
    session_id: i64,
    /// The user's "notify when a session ends" setting (off by default).
    notify: bool,
}

struct Inner {
    db: Arc<Database>,
    tracker: Mutex<Tracker>,
    wake: (Mutex<bool>, Condvar),
    started: AtomicBool,
}

/// Session Intelligence is offered for PoE 2 only; the data model is game-scoped
/// so a PoE 1 tracker could be added without schema changes.
#[derive(Clone)]
pub struct SessionService {
    inner: Arc<Inner>,
}

pub fn require_poe2(game: GameId) -> AppResult<()> {
    if game == GameId::Poe2 {
        Ok(())
    } else {
        Err(AppError::InvalidInput("Session Intelligence is available for Path of Exile 2 only.".into()))
    }
}

fn load_config(db: &Database, game: GameId) -> Config {
    match settings::get_game(db, game, tracker::CONFIG_KEY) {
        Ok(Some(v)) => serde_json::from_value::<Config>(v).map(Config::sanitized).unwrap_or_else(|e| {
            log::warn!("session config unreadable, using defaults: {e}");
            Config::default()
        }),
        Ok(None) => Config::default(),
        Err(e) => {
            log::warn!("session config unavailable, using defaults: {e}");
            Config::default()
        }
    }
}

impl SessionService {
    pub fn new(db: Arc<Database>) -> Self {
        let game = GameId::Poe2;
        let mut t = Tracker::new(
            game,
            Arc::clone(&db),
            Box::new(process::SystemProcesses::new()),
            Box::new(crate::market::http::unix_now),
            localtime::local_to_unix,
            tracker::default_discoverer(),
        );
        t.set_config(load_config(&db, game));
        Self { inner: Arc::new(Inner { db, tracker: Mutex::new(t), wake: (Mutex::new(false), Condvar::new()), started: AtomicBool::new(false) }) }
    }

    fn tracker(&self) -> AppResult<MutexGuard<'_, Tracker>> {
        self.inner.tracker.lock().map_err(|_| AppError::StatePoisoned)
    }

    /// Wakes the service thread for an immediate tick.
    pub fn poke(&self) {
        if let Ok(mut w) = self.inner.wake.0.lock() {
            *w = true;
            self.inner.wake.1.notify_one();
        }
    }

    pub fn start(&self, app: AppHandle) {
        if self.inner.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let spawned = std::thread::Builder::new().name("vaalytics-sessions".into()).spawn(move || run(inner, app));
        if let Err(e) = spawned {
            log::error!("session tracker thread failed to start: {e}");
        }
    }

    pub fn status(&self) -> AppResult<Status> {
        self.tracker()?.status()
    }

    pub fn diagnostics(&self) -> AppResult<Diagnostics> {
        Ok(self.tracker()?.diagnostics())
    }

    pub fn set_config(&self, config: Config) -> AppResult<Status> {
        let config = config.sanitized();
        let game = {
            let mut t = self.tracker()?;
            t.set_config(config.clone());
            t.game()
        };
        settings::set_game(&self.inner.db, game, tracker::CONFIG_KEY, &serde_json::to_value(&config)?)?;
        self.poke();
        self.status()
    }

    pub fn set_paused(&self, paused: bool) -> AppResult<Status> {
        self.tracker()?.set_paused(paused)?;
        self.poke();
        self.status()
    }

    pub fn set_manual_log(&self, path: Option<PathBuf>) -> AppResult<Status> {
        if let Some(p) = &path {
            discover::validate(p).map_err(AppError::InvalidInput)?;
        }
        self.tracker()?.set_manual_log(path)?;
        self.poke();
        self.status()
    }

    /// Deletes all completed sessions, the manual log path and the reader
    /// position, and restores default settings. An active session continues.
    pub fn reset(&self) -> AppResult<Status> {
        let game = self.tracker()?.game();
        store::delete_all(&*self.inner.db.conn()?, game)?;
        self.set_manual_log(None)?;
        self.set_config(Config::default())
    }
}

fn run(inner: Arc<Inner>, app: AppHandle) {
    log::info!("session tracker started");
    let mut last_emit: Option<Instant> = None;
    let mut pending_emit = false;
    loop {
        let (out, mut wait, game, notify) = match inner.tracker.lock() {
            Ok(mut t) => {
                let out = t.tick();
                let wait = if out.more_pending {
                    Duration::from_millis(50)
                } else if t.session_active() {
                    LIVE_READ_INTERVAL
                } else {
                    Duration::from_secs(t.config.poll_secs as u64)
                };
                (out, wait, t.game(), t.config.notify_on_summary)
            }
            Err(_) => {
                log::error!("session tracker state poisoned; stopping");
                return;
            }
        };
        if let Some(id) = out.completed {
            let _ = app.emit(EVENT_COMPLETED, CompletedEvent { game, session_id: id, notify });
        }
        pending_emit |= out.changed;
        if pending_emit {
            let due = last_emit.map(|t| t.elapsed() >= MIN_EMIT_INTERVAL).unwrap_or(true);
            if due {
                let _ = app.emit(EVENT_UPDATED, UpdatedEvent { game });
                last_emit = Some(Instant::now());
                pending_emit = false;
            } else if let Some(t) = last_emit {
                wait = wait.min(MIN_EMIT_INTERVAL.saturating_sub(t.elapsed()));
            }
        }
        let (lock, cv) = &inner.wake;
        let Ok(guard) = lock.lock() else { return };
        let Ok((mut woke, _)) = cv.wait_timeout_while(guard, wait, |w| !*w) else { return };
        *woke = false;
    }
}
