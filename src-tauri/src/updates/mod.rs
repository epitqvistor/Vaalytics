//! Update Center: the central synchronisation system for game data.
//! Spec: docs/modules/update-center.md · ADR docs/decisions/0005-update-center.md
//!
//! Pipeline: provider (fetch → parse → normalize) → change detection (`diff`) →
//! validation (`validate`) → staging (`store::stage`) → apply (transaction) → version
//! record → previous version kept → modules notified. Rollback re-installs a kept version.
//!
//! Game-data updates only. Application updates are a separate concern (see `app_update`).

pub mod diff;
pub mod fetch;
pub mod model;
pub mod patchnotes;
pub mod providers;
pub mod registry;
pub mod store;
pub mod validate;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::market::http::unix_now;
use crate::market::MarketEngine;
use model::{hash_entries, Confidence, Entry, FetchOutcome, ProviderError, Validation};
use providers::DatasetProvider;
use registry::{DatasetKind, Group, Policy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_PROGRESS: &str = "updates:progress";
pub const EVENT_FINISHED: &str = "updates:finished";
pub const EVENT_DATASET_CHANGED: &str = "updates:dataset-changed";
pub const SETTINGS_KEY: &str = "updates.settings";
const STARTUP_DELAY: Duration = Duration::from_secs(20);
/// Patch-note threads opened per forum per check, and only recent ones automatically.
const THREADS_PER_CHECK: i64 = 3;
const AUTO_PROCESS_MAX_AGE: i64 = 30 * 86_400;

// ---------- settings ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedules {
    pub game_data: String,
    pub leagues: String,
    pub patch_notes: String,
}

impl Default for Schedules {
    fn default() -> Self {
        // Game data keeps the daily refresh Deck Intelligence had; patch notes only on request.
        Self { game_data: "24h".into(), leagues: "24h".into(), patch_notes: "manual".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schedules: Schedules,
    /// Apply safe, validated updates automatically on scheduled runs and Synchronize All.
    pub auto_apply: bool,
    /// Older versions whose content is kept for rollback (per dataset).
    pub retention: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Self { schedules: Schedules::default(), auto_apply: true, retention: 5 }
    }
}

/// "manual" | "startup" | "6h" | "12h" | "24h" | "<n>h" (1–168). Returns the interval, if any.
pub fn schedule_interval(mode: &str) -> Option<i64> {
    let h = mode.strip_suffix('h')?.parse::<i64>().ok()?;
    (1..=168).contains(&h).then_some(h * 3600)
}

fn valid_schedule(mode: &str) -> bool {
    mode == "manual" || mode == "startup" || schedule_interval(mode).is_some()
}

// ---------- progress / reports ----------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub check_id: i64,
    pub kind: String,
    pub trigger: String,
    pub started_at: i64,
    pub operation: String,
    pub provider_id: Option<String>,
    pub game: Option<GameId>,
    pub dataset_id: Option<String>,
    pub done: usize,
    pub total: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub provider_id: String,
    pub dataset_id: Option<String>,
    pub operation: String,
    pub error: String,
    pub kind: String,
    pub retryable: bool,
    /// The installed version (if any) stays in use.
    pub existing_data_usable: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub check_id: i64,
    pub kind: String,
    pub status: String,
    pub tasks: usize,
    pub succeeded: usize,
    pub unchanged: Vec<String>,
    pub staged: Vec<Value>,
    pub applied: Vec<Value>,
    pub failures: Vec<Failure>,
    pub new_articles: usize,
    pub processed_articles: usize,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunKind {
    /// Discover only: stage changes, never install.
    Check,
    /// Discover and apply what the policy allows.
    Sync,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetChanged {
    pub dataset_id: String,
    pub game: GameId,
    pub version_id: i64,
    pub modules: Vec<&'static str>,
    pub reason: &'static str,
}

type Listener = Box<dyn Fn(&DatasetChanged) + Send + Sync>;

pub struct UpdateService {
    db: Arc<Database>,
    market: Arc<MarketEngine>,
    fetcher: Arc<fetch::Fetcher>,
    providers: Vec<Box<dyn DatasetProvider>>,
    run_lock: tokio::sync::Mutex<()>,
    progress: Mutex<Option<Progress>>,
    app: OnceLock<AppHandle>,
    wake: tokio::sync::Notify,
    listeners: Mutex<Vec<Listener>>,
    /// Scheduler memory: group → (last attempt, consecutive failures).
    attempts: Mutex<HashMap<&'static str, (i64, u32)>>,
    data_dir: OnceLock<std::path::PathBuf>,
}

fn group_key(g: Group) -> &'static str {
    match g {
        Group::GameData => "gameData",
        Group::Leagues => "leagues",
        Group::PatchNotes => "patchNotes",
        Group::Market => "market",
        Group::Bundled => "bundled",
    }
}

impl UpdateService {
    pub fn new(db: Arc<Database>, market: Arc<MarketEngine>) -> Arc<Self> {
        let fetcher = Arc::new(fetch::Fetcher::new());
        let providers: Vec<Box<dyn DatasetProvider>> = vec![
            Box::new(providers::RepoeCards { fetcher: Arc::clone(&fetcher) }),
            Box::new(providers::NinjaLeagues { market: Arc::clone(&market) }),
        ];
        Self::with_providers(db, market, fetcher, providers)
    }

    pub(crate) fn with_providers(db: Arc<Database>, market: Arc<MarketEngine>, fetcher: Arc<fetch::Fetcher>, providers: Vec<Box<dyn DatasetProvider>>) -> Arc<Self> {
        Arc::new(Self {
            db,
            market,
            fetcher,
            providers,
            run_lock: tokio::sync::Mutex::new(()),
            progress: Mutex::new(None),
            app: OnceLock::new(),
            wake: tokio::sync::Notify::new(),
            listeners: Mutex::new(Vec::new()),
            attempts: Mutex::new(HashMap::new()),
            data_dir: OnceLock::new(),
        })
    }

    /// App data folder (to read the Crafting service's cache timestamp for its status).
    pub fn set_data_dir(&self, dir: std::path::PathBuf) {
        let _ = self.data_dir.set(dir);
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    /// The league selected in a game's workspace (same setting the league picker uses),
    /// or the first league of the index when none is chosen yet.
    pub fn selected_league(&self, game: GameId) -> Option<String> {
        crate::settings::get_game(&self.db, game, "market.league")
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(str::to_owned))
            .filter(|s| !s.is_empty())
            .or_else(|| {
                // Same rule as the UI's `defaultLeague` (src/core/market/derive.ts).
                let l = crate::market::store::leagues(&self.db, game).ok()?;
                let soft: Vec<_> = l.iter().filter(|x| !x.hardcore).collect();
                soft.iter().find(|x| x.indexed && x.name != "Standard").or(soft.first()).map(|x| x.name.clone()).or_else(|| l.first().map(|x| x.name.clone()))
            })
    }

    /// Everything the Overview, Game Data, Sources and module views need, in one call.
    pub fn overview(&self) -> AppResult<Value> {
        let now = unix_now();
        let pending: HashMap<String, (i64, i64)> = store::pending_counts(&self.db)?.into_iter().map(|(d, n, r)| (d, (n, r))).collect();
        let leagues: HashMap<GameId, Option<String>> = GameId::ALL.iter().map(|g| (*g, self.selected_league(*g))).collect();
        let mut datasets = Vec::new();
        for d in registry::DATASETS {
            let installed = store::installed(&self.db, d.id)?;
            let staged = store::staged(&self.db, d.id)?;
            let state = store::dataset_state(&self.db, d.id)?;
            let (p, r) = pending.get(d.id).copied().unwrap_or((0, 0));
            let market = if d.category == "market-prices" {
                leagues[&d.game].as_deref().map(|l| store::market_state(&self.db, d.game, l)).transpose()?
            } else {
                None
            };
            let cache_written = if d.id == "poe1.crafting-data" {
                self.data_dir.get().and_then(|dir| std::fs::metadata(dir.join("crafting").join("poe1.json")).ok()).and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64)
            } else {
                None
            };
            let interval = match d.group {
                Group::GameData => schedule_interval(&self.settings().schedules.game_data),
                Group::Leagues => schedule_interval(&self.settings().schedules.leagues),
                _ => None,
            };
            datasets.push(json!({
                "def": d,
                "consumers": registry::consumers(d.id),
                "installed": installed,
                "staged": staged,
                "state": state,
                "pending": p,
                "pendingReview": r,
                "market": market,
                "cacheWrittenAt": cache_written,
                "intervalSecs": interval,
            }));
        }
        let mut sources = Vec::new();
        for p in registry::PROVIDERS {
            let st = store::source_state(&self.db, p.id)?;
            sources.push(json!({ "meta": p, "state": st, "datasets": registry::DATASETS.iter().filter(|d| d.provider_id == p.id).map(|d| d.id).collect::<Vec<_>>() }));
        }
        let (last_attempt, last_success) = store::last_check_of(&self.db, &["check", "sync"])?;
        Ok(json!({
            "now": now,
            "datasets": datasets,
            "sources": sources,
            "modules": registry::MODULES,
            "lastAttempt": last_attempt,
            "lastSuccess": last_success,
            "running": self.progress(),
            "settings": self.settings(),
            "selectedLeagues": { "poe1": leagues[&GameId::Poe1], "poe2": leagues[&GameId::Poe2] },
            "articlesUnreviewed": store::articles(&self.db, 500)?.iter().filter(|a| !a.reviewed && a.analysis.is_some()).count(),
        }))
    }

    /// Registers a Rust-side consumer notification (e.g. Deck Intelligence rebuilds its matcher).
    pub fn on_dataset_changed(&self, f: impl Fn(&DatasetChanged) + Send + Sync + 'static) {
        if let Ok(mut l) = self.listeners.lock() {
            l.push(Box::new(f));
        }
    }

    pub fn settings(&self) -> Settings {
        crate::settings::get_app(&self.db, SETTINGS_KEY).ok().flatten().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }

    pub fn set_settings(&self, s: Settings) -> AppResult<Settings> {
        for m in [&s.schedules.game_data, &s.schedules.leagues, &s.schedules.patch_notes] {
            if !valid_schedule(m) {
                return Err(AppError::InvalidInput(format!("Unknown schedule {m:?}.")));
            }
        }
        if !(1..=50).contains(&s.retention) {
            return Err(AppError::InvalidInput("Keep between 1 and 50 previous versions.".into()));
        }
        crate::settings::set_app(&self.db, SETTINGS_KEY, &serde_json::to_value(&s)?)?;
        self.wake.notify_one();
        Ok(s)
    }

    pub fn progress(&self) -> Option<Progress> {
        self.progress.lock().ok().and_then(|p| p.clone())
    }

    fn set_progress(&self, f: impl FnOnce(&mut Progress)) {
        let snapshot = {
            let Ok(mut guard) = self.progress.lock() else { return };
            let Some(p) = guard.as_mut() else { return };
            f(p);
            p.clone()
        };
        if let Some(app) = self.app.get() {
            let _ = app.emit(EVENT_PROGRESS, snapshot);
        }
    }

    fn notify(&self, ev: DatasetChanged) {
        if let Ok(l) = self.listeners.lock() {
            for f in l.iter() {
                f(&ev);
            }
        }
        if let Some(app) = self.app.get() {
            let _ = app.emit(EVENT_DATASET_CHANGED, &ev);
        }
    }

    fn provider_for(&self, dataset_id: &str) -> Option<&dyn DatasetProvider> {
        self.providers.iter().find(|p| p.datasets().contains(&dataset_id)).map(|b| b.as_ref())
    }

    fn source_enabled(&self, id: &str) -> bool {
        store::source_state(&self.db, id).map(|s| s.enabled).unwrap_or(true)
    }

    // ---------- run ----------

    /// Runs a check or synchronisation over the given groups. `wait` queues behind a
    /// running check instead of refusing.
    pub async fn run(self: &Arc<Self>, kind: RunKind, trigger: &'static str, groups: &[Group], only: Option<&[&str]>, wait: bool) -> AppResult<Report> {
        let _guard = if wait {
            self.run_lock.lock().await
        } else {
            self.run_lock.try_lock().map_err(|_| AppError::InvalidInput("An update check is already running.".into()))?
        };
        let started = Instant::now();
        let now = unix_now();
        let kind_s = if kind == RunKind::Check { "check" } else { "sync" };
        let check_id = store::start_check(&self.db, kind_s, trigger, now)?;
        let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "check_started", status: "info", message: format!("{} started ({trigger})", if kind == RunKind::Check { "Check for updates" } else { "Synchronisation" }), ..Default::default() }, now);

        let datasets: Vec<&'static registry::DatasetDef> = registry::DATASETS
            .iter()
            .filter(|d| d.kind == DatasetKind::Versioned && groups.contains(&d.group))
            .filter(|d| only.is_none_or(|o| o.contains(&d.id)))
            .collect();
        let patch_notes = groups.contains(&Group::PatchNotes) && only.is_none();
        let total = datasets.len() + if patch_notes { 2 } else { 0 };
        if let Ok(mut p) = self.progress.lock() {
            *p = Some(Progress { check_id, kind: kind_s.into(), trigger: trigger.into(), started_at: now, operation: "Starting".into(), total, ..Default::default() });
        }
        self.set_progress(|_| {});

        let mut report = Report { check_id, kind: kind_s.into(), tasks: total, ..Default::default() };
        let auto = kind == RunKind::Sync;
        for def in datasets {
            self.check_dataset(def, check_id, auto, &mut report).await;
            self.set_progress(|p| p.done += 1);
        }
        if patch_notes {
            self.discover_articles(check_id, &mut report).await;
        }

        report.duration_ms = started.elapsed().as_millis() as i64;
        report.status = match (report.failures.is_empty(), report.succeeded) {
            (true, _) => "ok",
            (false, 0) => "failed",
            (false, _) => "partial",
        }
        .into();
        let fin = unix_now();
        let summary = serde_json::to_value(&report)?;
        store::finish_check(&self.db, check_id, &report.status, &summary, fin)?;
        let _ = store::event(
            &self.db,
            store::NewEvent {
                check_id: Some(check_id),
                kind: "check_finished",
                status: match report.status.as_str() { "ok" => "ok", "partial" => "warning", _ => "error" },
                message: format!(
                    "{} of {} tasks succeeded · {} staged · {} applied{}",
                    report.succeeded,
                    report.tasks,
                    report.staged.len(),
                    report.applied.len(),
                    if report.failures.is_empty() { String::new() } else { format!(" · {} failed", report.failures.len()) }
                ),
                duration_ms: Some(report.duration_ms),
                ..Default::default()
            },
            fin,
        );
        if let Ok(mut p) = self.progress.lock() {
            *p = None;
        }
        if let Some(app) = self.app.get() {
            let _ = app.emit(EVENT_FINISHED, &report);
        }
        Ok(report)
    }

    fn fail(&self, report: &mut Report, check_id: i64, def: &registry::DatasetDef, provider_id: &str, op: &str, e: &ProviderError, duration_ms: i64) {
        let now = unix_now();
        let msg = e.to_string();
        let _ = store::record_source(&self.db, provider_id, now, duration_ms, 0, Some((e.kind(), &msg)), false);
        let _ = store::record_dataset_check(&self.db, def.id, def.game, now, None, None, Some(&msg));
        let usable = store::installed(&self.db, def.id).ok().flatten().is_some();
        let _ = store::event(
            &self.db,
            store::NewEvent {
                check_id: Some(check_id),
                kind: if matches!(e, ProviderError::Invalid(_)) && op == "validate" { "validation_failed" } else { "source_failed" },
                game: Some(def.game),
                dataset_id: Some(def.id),
                provider_id: Some(provider_id),
                modules: registry::consumers(def.id),
                status: "error",
                message: format!("{}: {msg}", def.label),
                duration_ms: Some(duration_ms),
                ..Default::default()
            },
            now,
        );
        self.set_progress(|p| p.errors.push(format!("{} ({}): {msg}", def.label, def.game)));
        report.failures.push(Failure {
            provider_id: provider_id.into(),
            dataset_id: Some(def.id.into()),
            operation: op.into(),
            error: msg,
            kind: e.kind().into(),
            retryable: e.transient(),
            existing_data_usable: usable,
        });
    }

    async fn check_dataset(self: &Arc<Self>, def: &'static registry::DatasetDef, check_id: i64, auto: bool, report: &mut Report) {
        let Some(provider) = self.provider_for(def.id) else { return };
        let pid = provider.id();
        if !self.source_enabled(pid) {
            report.succeeded += 1; // skipped on purpose, not a failure
            report.unchanged.push(format!("{} (source disabled)", def.id));
            return;
        }
        let meta = registry::provider(pid).expect("registered provider");
        self.set_progress(|p| {
            p.operation = format!("Checking {}", def.label);
            p.provider_id = Some(pid.into());
            p.game = Some(def.game);
            p.dataset_id = Some(def.id.into());
        });
        let t0 = Instant::now();
        let installed = store::installed_entries(&self.db, def.id).ok().flatten();
        let etag = if installed.is_some() { store::dataset_state(&self.db, def.id).ok().and_then(|s| s.etag) } else { None };
        let outcome = provider.fetch(def.id, etag).await;
        let ms = t0.elapsed().as_millis() as i64;
        let now = unix_now();
        let payload = match outcome {
            Err(e) => return self.fail(report, check_id, def, pid, "fetch", &e, ms),
            Ok(FetchOutcome::NotModified) => {
                let _ = store::record_source(&self.db, pid, now, ms, 0, None, false);
                let _ = store::record_dataset_check(&self.db, def.id, def.game, now, None, None, None);
                let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "no_changes", game: Some(def.game), dataset_id: Some(def.id), provider_id: Some(pid), status: "ok", message: format!("{}: not modified at the source", def.label), duration_ms: Some(ms), ..Default::default() }, now);
                report.succeeded += 1;
                report.unchanged.push(def.id.into());
                return;
            }
            Ok(FetchOutcome::Data(p)) => p,
        };
        // Game isolation: a provider may only deliver the dataset (and game) it was asked for.
        if payload.dataset_id != def.id || payload.game != def.game {
            return self.fail(report, check_id, def, pid, "fetch", &ProviderError::Structure(format!("provider returned {} ({}) for {}", payload.dataset_id, payload.game, def.id)), ms);
        }
        self.set_progress(|p| p.operation = format!("Comparing {}", def.label));
        let hash = hash_entries(&payload.entries);
        let (installed_v, installed_e) = match installed {
            Some((v, e)) => (Some(v), e),
            None => (None, Vec::new()),
        };
        if installed_v.as_ref().is_some_and(|v| v.content_hash == hash && v.format == def.format) {
            let _ = store::record_source(&self.db, pid, now, ms, payload.bytes, None, false);
            let _ = store::record_dataset_check(&self.db, def.id, def.game, now, payload.etag.as_deref(), payload.source_version.as_deref(), None);
            let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "no_changes", game: Some(def.game), dataset_id: Some(def.id), provider_id: Some(pid), status: "ok", message: format!("{}: no changes ({} entries)", def.label, payload.entries.len()), duration_ms: Some(ms), ..Default::default() }, now);
            // A staged version older than what the source now returns is obsolete.
            let _ = self.supersede_staged(def.id, now);
            report.succeeded += 1;
            report.unchanged.push(def.id.into());
            return;
        }
        let (changes, summary) = diff::diff(def, &installed_e, &payload.entries);
        self.set_progress(|p| p.operation = format!("Validating {}", def.label));
        let outcome = validate::validate(def, &payload.entries, installed_e.len(), Some(&summary), meta.reliability);
        if outcome.result == Validation::Failed {
            let msg = outcome.notes.iter().filter(|n| n.level == Validation::Failed).map(|n| n.message.clone()).collect::<Vec<_>>().join(" ");
            return self.fail(report, check_id, def, pid, "validate", &ProviderError::Invalid(msg), ms);
        }
        let base_conf = Confidence::for_source(meta.reliability);
        let annotated: Vec<(diff::Change, Confidence, bool)> = changes
            .into_iter()
            .map(|c| {
                let review = def.policy == Policy::Review || outcome.result >= Validation::Review || c.change_type == model::ChangeType::Structural;
                let conf = if review && base_conf == Confidence::Confirmed && c.change_type == model::ChangeType::Structural { Confidence::Review } else { base_conf };
                (c, conf, review)
            })
            .collect();
        let needs_review = annotated.iter().any(|(_, _, r)| *r);
        let version = store::NewVersion {
            dataset_id: def.id,
            game: def.game,
            league: payload.league.as_deref(),
            format: def.format,
            label: hash[..8].to_string(),
            content_hash: hash.clone(),
            entries: &payload.entries,
            provider_id: pid,
            source_url: Some(&payload.source_url),
            source_version: payload.source_version.as_deref(),
            retrieved_at: now,
            now,
            origin: "source",
            validation: outcome.result,
            notes: &outcome.notes,
            parent_id: installed_v.as_ref().map(|v| v.id),
            check_id: Some(check_id),
        };
        let staged_id = match store::stage(&self.db, &version, &annotated, now) {
            Ok(id) => id,
            Err(e) => return self.fail(report, check_id, def, pid, "stage", &ProviderError::Invalid(e.to_string()), ms),
        };
        let _ = store::record_source(&self.db, pid, now, ms, payload.bytes, None, outcome.result == Validation::Warnings);
        let _ = store::record_dataset_check(&self.db, def.id, def.game, now, payload.etag.as_deref(), payload.source_version.as_deref(), None);
        let counts = format!("{} added, {} modified, {} removed, {} deprecated{}", summary.added, summary.modified, summary.removed, summary.deprecated, if summary.structural { ", structure changed" } else { "" });
        let _ = store::event(
            &self.db,
            store::NewEvent {
                check_id: Some(check_id),
                kind: "changes_detected",
                game: Some(def.game),
                dataset_id: Some(def.id),
                provider_id: Some(pid),
                modules: registry::consumers(def.id),
                to_version: Some(staged_id),
                status: if needs_review { "warning" } else { "info" },
                message: format!("{}: {counts} (validation: {})", def.label, outcome.result.as_str()),
                duration_ms: Some(ms),
                ..Default::default()
            },
            now,
        );
        report.succeeded += 1;
        report.staged.push(json!({ "datasetId": def.id, "versionId": staged_id, "changes": annotated.len(), "needsReview": needs_review, "validation": outcome.result.as_str(), "summary": counts }));
        if auto && def.policy == Policy::Auto && !needs_review && outcome.result <= Validation::Warnings {
            match self.apply_inner(def, None, check_id, "auto_applied") {
                Ok(v) => report.applied.push(json!({ "datasetId": def.id, "versionId": v })),
                Err(e) => report.failures.push(Failure { provider_id: pid.into(), dataset_id: Some(def.id.into()), operation: "apply".into(), error: e.to_string(), kind: "apply".into(), retryable: true, existing_data_usable: true }),
            }
        }
    }

    fn supersede_staged(&self, dataset_id: &str, now: i64) -> AppResult<()> {
        let conn = self.db.conn()?;
        conn.execute("UPDATE update_changes SET status = 'superseded', resolved_at = ?2 WHERE dataset_id = ?1 AND status = 'pending'", rusqlite::params![dataset_id, now])?;
        conn.execute("UPDATE update_versions SET status = 'discarded' WHERE dataset_id = ?1 AND status = 'staged'", rusqlite::params![dataset_id])?;
        Ok(())
    }

    // ---------- apply / rollback ----------

    /// Applies the staged update of a dataset: all its pending changes, or only `selected`.
    pub async fn apply(self: &Arc<Self>, dataset_id: &str, selected: Option<Vec<i64>>) -> AppResult<i64> {
        let def = registry::dataset(dataset_id).filter(|d| d.kind == DatasetKind::Versioned).ok_or_else(|| AppError::InvalidInput("Unknown dataset.".into()))?;
        let _guard = self.run_lock.lock().await;
        let now = unix_now();
        let check_id = store::start_check(&self.db, "apply", "user", now)?;
        let r = self.apply_inner(def, selected, check_id, "applied");
        let status = if r.is_ok() { "ok" } else { "failed" };
        store::finish_check(&self.db, check_id, status, &json!({ "datasetId": dataset_id, "error": r.as_ref().err().map(|e| e.to_string()) }), unix_now())?;
        r
    }

    fn apply_inner(&self, def: &'static registry::DatasetDef, selected: Option<Vec<i64>>, check_id: i64, event_kind: &'static str) -> AppResult<i64> {
        let now = unix_now();
        let staged = store::staged(&self.db, def.id)?.ok_or_else(|| AppError::InvalidInput("There is no staged update for this dataset. Check for updates first.".into()))?;
        let of_staged: Vec<store::ChangeRow> = store::changes(&self.db, None, Some(def.id), 100_000)?.into_iter().filter(|c| c.version_id == Some(staged.id)).collect();
        let pending: Vec<&store::ChangeRow> = of_staged.iter().filter(|c| c.status == "pending").collect();
        let chosen: Vec<&store::ChangeRow> = match &selected {
            Some(ids) => pending.iter().copied().filter(|c| ids.contains(&c.id)).collect(),
            None => pending.clone(),
        };
        if chosen.is_empty() {
            return Err(AppError::InvalidInput("Nothing selected to apply.".into()));
        }
        let ids: Vec<i64> = chosen.iter().map(|c| c.id).collect();
        let full = chosen.len() == of_staged.iter().filter(|c| c.status == "pending" || c.status == "ignored").count();
        let previous = store::installed(&self.db, def.id)?;
        let (new_id, prev_id, entries) = if full {
            let entries = store::entries(&self.db, staged.id)?.ok_or_else(|| AppError::InvalidInput("Staged data is missing.".into()))?;
            let prev = store::install(&self.db, staged.id, &ids, now)?;
            (staged.id, prev, entries)
        } else {
            if chosen.iter().any(|c| c.change_type == "structural") {
                return Err(AppError::InvalidInput("A structure change can only be applied together with the whole update.".into()));
            }
            let base = match &previous {
                Some(v) => store::entries(&self.db, v.id)?.unwrap_or_default(),
                None => Vec::new(),
            };
            let as_changes: Vec<diff::Change> = chosen
                .iter()
                .map(|c| diff::Change { key: c.entry_key.clone(), name: c.entry_name.clone(), change_type: model::ChangeType::Unknown, fields: c.fields.clone(), before: c.before.clone(), after: c.after.clone() })
                .collect();
            let merged = diff::apply_changes(&base, &as_changes);
            let meta = registry::provider(def.provider_id).expect("registered provider");
            let outcome = validate::validate(def, &merged, base.len(), None, meta.reliability);
            if outcome.result == Validation::Failed {
                let msg = outcome.notes.iter().map(|n| n.message.clone()).collect::<Vec<_>>().join(" ");
                let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "validation_failed", game: Some(def.game), dataset_id: Some(def.id), status: "error", message: format!("{}: partial update rejected — {msg}", def.label), ..Default::default() }, now);
                return Err(AppError::InvalidInput(format!("The selection doesn't pass validation: {msg}")));
            }
            let hash = hash_entries(&merged);
            let v = store::NewVersion {
                dataset_id: def.id,
                game: def.game,
                league: None,
                format: def.format,
                label: hash[..8].to_string(),
                content_hash: hash.clone(),
                entries: &merged,
                provider_id: &staged.provider_id,
                source_url: staged.source_url.as_deref(),
                source_version: staged.source_version.as_deref(),
                retrieved_at: staged.retrieved_at,
                now,
                origin: "partial",
                validation: outcome.result,
                notes: &outcome.notes,
                parent_id: previous.as_ref().map(|p| p.id),
                check_id: Some(check_id),
            };
            let (id, prev) = store::insert_and_install(&self.db, &v, &ids, now)?;
            (id, prev, merged)
        };
        self.after_install(def, new_id, prev_id, &entries, check_id, event_kind, format!("{} change(s){}", ids.len(), if full { "" } else { " (partial)" }), now);
        Ok(new_id)
    }

    #[allow(clippy::too_many_arguments)]
    fn after_install(&self, def: &'static registry::DatasetDef, new_id: i64, prev_id: Option<i64>, entries: &[Entry], check_id: i64, kind: &'static str, what: String, now: i64) {
        if def.category == "leagues" {
            if let Err(e) = store::sync_league_profiles(&self.db, def.game, entries, def.provider_id, now) {
                log::warn!("league profiles sync failed: {e}");
            }
        }
        let modules = registry::consumers(def.id);
        let _ = store::event(
            &self.db,
            store::NewEvent {
                check_id: Some(check_id),
                kind,
                game: Some(def.game),
                dataset_id: Some(def.id),
                provider_id: Some(def.provider_id),
                modules: modules.clone(),
                from_version: prev_id,
                to_version: Some(new_id),
                status: "ok",
                message: format!("{}: {what} {}", def.label, if kind == "rollback" { "restored" } else { "installed" }),
                ..Default::default()
            },
            now,
        );
        let keep = self.settings().retention;
        if let Ok(n) = store::prune(&self.db, def.id, keep) {
            if n > 0 {
                let _ = store::event(&self.db, store::NewEvent { kind: "pruned", dataset_id: Some(def.id), game: Some(def.game), status: "info", message: format!("{}: data of {n} old version(s) removed (keeping {keep})", def.label), ..Default::default() }, now);
            }
        }
        self.notify(DatasetChanged { dataset_id: def.id.into(), game: def.game, version_id: new_id, modules, reason: kind });
    }

    pub async fn rollback(self: &Arc<Self>, dataset_id: &str, version_id: i64) -> AppResult<i64> {
        let def = registry::dataset(dataset_id).filter(|d| d.kind == DatasetKind::Versioned).ok_or_else(|| AppError::InvalidInput("Unknown dataset.".into()))?;
        let _guard = self.run_lock.lock().await;
        let now = unix_now();
        let target = store::version(&self.db, version_id)?.filter(|v| v.dataset_id == dataset_id).ok_or_else(|| AppError::InvalidInput("Unknown version.".into()))?;
        if target.format != def.format {
            return Err(AppError::InvalidInput("This version has an older data format and can't be restored by this app version.".into()));
        }
        if target.status == "installed" {
            return Err(AppError::InvalidInput("This version is already installed.".into()));
        }
        let entries = store::entries(&self.db, version_id)?.ok_or_else(|| AppError::InvalidInput("This version's data was removed by the retention policy.".into()))?;
        let meta = registry::provider(def.provider_id).expect("registered provider");
        let outcome = validate::validate(def, &entries, 0, None, meta.reliability);
        if outcome.result == Validation::Failed {
            return Err(AppError::InvalidInput("The stored version doesn't pass validation any more; it was not restored.".into()));
        }
        let check_id = store::start_check(&self.db, "rollback", "user", now)?;
        // Pending changes were computed against the current version; they no longer apply.
        self.supersede_staged(dataset_id, now)?;
        let prev = store::install(&self.db, version_id, &[], now)?;
        self.after_install(def, version_id, prev, &entries, check_id, "rollback", format!("version {}", target.label), now);
        store::finish_check(&self.db, check_id, "ok", &json!({ "datasetId": dataset_id, "from": prev, "to": version_id }), unix_now())?;
        Ok(version_id)
    }

    // ---------- patch notes ----------

    async fn discover_articles(self: &Arc<Self>, check_id: i64, report: &mut Report) {
        if self.source_enabled("ggg-patch-notes") {
            self.set_progress(|p| {
                p.operation = "Looking for official patch notes".into();
                p.provider_id = Some("ggg-patch-notes".into());
                p.dataset_id = None;
            });
            let t0 = Instant::now();
            let mut errors: Vec<(GameId, ProviderError)> = Vec::new();
            let mut new_total = 0;
            for (game, url) in [(GameId::Poe1, patchnotes::POE1_FORUM), (GameId::Poe2, patchnotes::POE2_FORUM)] {
                self.set_progress(|p| p.game = Some(game));
                match self.fetcher.get(url, None, "text/html", 4 * 1024 * 1024).await {
                    Ok(fetch::Fetched::Body(r)) => {
                        let html = String::from_utf8_lossy(&r.body);
                        let found = patchnotes::parse_forum_list(&html, game);
                        if found.is_empty() {
                            errors.push((game, ProviderError::Structure("no threads found on the patch-notes forum page".into())));
                            continue;
                        }
                        let n = store::insert_articles(&self.db, "ggg-patch-notes", &found, unix_now()).unwrap_or(0);
                        new_total += n;
                        for a in store::unprocessed_articles(&self.db, "ggg-patch-notes", game, THREADS_PER_CHECK).unwrap_or_default() {
                            if a.published_at.is_some_and(|t| unix_now() - t > AUTO_PROCESS_MAX_AGE) {
                                continue;
                            }
                            self.set_progress(|p| p.operation = format!("Reading {}", a.title));
                            if self.process_article_inner(&a).await.is_ok() {
                                report.processed_articles += 1;
                            }
                        }
                    }
                    Ok(fetch::Fetched::NotModified) => {}
                    Err(e) => errors.push((game, e)),
                }
            }
            report.new_articles += new_total;
            self.finish_article_source("ggg-patch-notes", check_id, t0, new_total, errors, report);
        }
        self.set_progress(|p| p.done += 1);
        if self.source_enabled("ggg-news") {
            self.set_progress(|p| {
                p.operation = "Reading the official news feed".into();
                p.provider_id = Some("ggg-news".into());
                p.game = None;
            });
            let t0 = Instant::now();
            let mut errors = Vec::new();
            let mut n = 0;
            match self.fetcher.get(patchnotes::NEWS_RSS, None, "application/rss+xml, application/xml", 2 * 1024 * 1024).await {
                Ok(fetch::Fetched::Body(r)) => {
                    let items = patchnotes::parse_rss(&String::from_utf8_lossy(&r.body));
                    if items.is_empty() {
                        errors.push((GameId::Poe1, ProviderError::Structure("the feed has no items".into())));
                    }
                    n = store::insert_articles(&self.db, "ggg-news", &items, unix_now()).unwrap_or(0);
                }
                Ok(fetch::Fetched::NotModified) => {}
                Err(e) => errors.push((GameId::Poe1, e)),
            }
            report.new_articles += n;
            self.finish_article_source("ggg-news", check_id, t0, n, errors, report);
        }
        self.set_progress(|p| p.done += 1);
    }

    fn finish_article_source(&self, pid: &str, check_id: i64, t0: Instant, new: usize, errors: Vec<(GameId, ProviderError)>, report: &mut Report) {
        let ms = t0.elapsed().as_millis() as i64;
        let now = unix_now();
        if errors.is_empty() {
            let _ = store::record_source(&self.db, pid, now, ms, 0, None, false);
            report.succeeded += 1;
            if new > 0 {
                let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "articles_discovered", provider_id: Some(pid), status: "info", message: format!("{new} new article(s)"), duration_ms: Some(ms), ..Default::default() }, now);
            }
        } else {
            for (game, e) in errors {
                let msg = e.to_string();
                let _ = store::record_source(&self.db, pid, now, ms, 0, Some((e.kind(), &msg)), false);
                let _ = store::event(&self.db, store::NewEvent { check_id: Some(check_id), kind: "source_failed", game: Some(game), provider_id: Some(pid), status: "error", message: msg.clone(), duration_ms: Some(ms), ..Default::default() }, now);
                report.failures.push(Failure { provider_id: pid.into(), dataset_id: None, operation: "discover".into(), error: msg, kind: e.kind().into(), retryable: e.transient(), existing_data_usable: true });
            }
        }
    }

    async fn process_article_inner(&self, a: &store::ArticleRow) -> AppResult<Value> {
        let now = unix_now();
        let result: Result<Value, String> = async {
            if !a.url.starts_with(patchnotes::THREAD_BASE) {
                return Err("Only forum threads can be analysed.".to_string());
            }
            match self.fetcher.get(&a.url, None, "text/html", 4 * 1024 * 1024).await.map_err(|e| e.to_string())? {
                fetch::Fetched::Body(r) => {
                    let html = String::from_utf8_lossy(&r.body);
                    let lines = patchnotes::first_post_lines(&html).ok_or("The thread layout changed; no post found.")?;
                    let game = a.game.as_deref().and_then(|g| g.parse::<GameId>().ok());
                    Ok(patchnotes::analyze(game, &a.title, &lines))
                }
                fetch::Fetched::NotModified => Err("not modified".into()),
            }
        }
        .await;
        match result {
            Ok(v) => {
                store::set_article_analysis(&self.db, &a.provider_id, &a.article_id, Ok(&v), now)?;
                let _ = store::event(&self.db, store::NewEvent { kind: "article_processed", game: a.game.as_deref().and_then(|g| g.parse().ok()), provider_id: Some(&a.provider_id), status: "info", message: format!("Analysed “{}”", a.title), ..Default::default() }, now);
                Ok(v)
            }
            Err(e) => {
                store::set_article_analysis(&self.db, &a.provider_id, &a.article_id, Err(&e), now)?;
                Err(AppError::InvalidInput(e))
            }
        }
    }

    /// Analyses one article on request (also retries a failed one).
    pub async fn process_article(&self, provider_id: &str, article_id: &str) -> AppResult<Value> {
        let a = store::article(&self.db, provider_id, article_id)?.ok_or_else(|| AppError::InvalidInput("Unknown article.".into()))?;
        self.process_article_inner(&a).await
    }

    // ---------- sources ----------

    /// Connectivity test: a cheap request (conditional where possible) that also checks the response shape.
    pub async fn test_source(&self, provider_id: &str) -> AppResult<Value> {
        let t0 = Instant::now();
        let r: Result<String, ProviderError> = match provider_id {
            "repoe-poe1" => {
                let etag = store::dataset_state(&self.db, "poe1.divination-cards").ok().and_then(|s| s.etag);
                match self.fetcher.get(providers::REPOE_BASE_ITEMS, etag.as_deref(), "application/json", 48 * 1024 * 1024).await {
                    Ok(fetch::Fetched::NotModified) => Ok("Reachable — data unchanged since the last check (HTTP 304).".into()),
                    Ok(fetch::Fetched::Body(b)) => {
                        serde_json::from_slice::<Value>(&b.body)
                            .map_err(|e| ProviderError::Invalid(e.to_string()))
                            .and_then(|v| providers::card_entries(&v))
                            .map(|e| format!("Reachable — {} divination cards in the current export.", e.len()))
                    }
                    Err(e) => Err(e),
                }
            }
            "poe-ninja" => self.market.refresh_leagues(GameId::Poe1).await.map(|l| format!("Reachable — {} PoE 1 leagues listed.", l.len())).map_err(ProviderError::Unavailable),
            "ggg-patch-notes" => match self.fetcher.get(patchnotes::POE1_FORUM, None, "text/html", 4 * 1024 * 1024).await {
                Ok(fetch::Fetched::Body(b)) => {
                    let n = patchnotes::parse_forum_list(&String::from_utf8_lossy(&b.body), GameId::Poe1).len();
                    if n == 0 { Err(ProviderError::Structure("no threads found".into())) } else { Ok(format!("Reachable — {n} threads on the PoE 1 patch-notes page.")) }
                }
                Ok(_) => Ok("Reachable.".into()),
                Err(e) => Err(e),
            },
            "ggg-news" => match self.fetcher.get(patchnotes::NEWS_RSS, None, "application/rss+xml", 2 * 1024 * 1024).await {
                Ok(fetch::Fetched::Body(b)) => {
                    let n = patchnotes::parse_rss(&String::from_utf8_lossy(&b.body)).len();
                    if n == 0 { Err(ProviderError::Structure("the feed has no items".into())) } else { Ok(format!("Reachable — {n} items in the feed.")) }
                }
                Ok(_) => Ok("Reachable.".into()),
                Err(e) => Err(e),
            },
            _ => return Err(AppError::InvalidInput("Unknown source.".into())),
        };
        let ms = t0.elapsed().as_millis() as i64;
        let now = unix_now();
        match &r {
            Ok(_) => store::record_source(&self.db, provider_id, now, ms, 0, None, false)?,
            Err(e) => store::record_source(&self.db, provider_id, now, ms, 0, Some((e.kind(), &e.to_string())), false)?,
        }
        Ok(json!({ "ok": r.is_ok(), "message": r.as_ref().map(String::clone).unwrap_or_else(|e| e.to_string()), "kind": r.as_ref().err().map(|e| e.kind()), "durationMs": ms }))
    }

    pub fn set_source_enabled(&self, provider_id: &str, enabled: bool) -> AppResult<()> {
        registry::provider(provider_id).ok_or_else(|| AppError::InvalidInput("Unknown source.".into()))?;
        store::set_source_enabled(&self.db, provider_id, enabled)?;
        store::event(&self.db, store::NewEvent { kind: "source_toggled", provider_id: Some(provider_id), status: "info", message: format!("Source {}", if enabled { "enabled" } else { "disabled" }), ..Default::default() }, unix_now())
    }

    // ---------- module access ----------

    /// The installed Divination Card list (Deck Intelligence). Installs it first when
    /// missing, or refreshes when `force`; imports Deck Intelligence's former cache if the
    /// source can't be reached on first use.
    pub async fn divination_cards(self: &Arc<Self>, force: bool, legacy: Option<crate::decks::cards::CardDb>) -> AppResult<(store::VersionInfo, Vec<crate::decks::cards::Card>, Option<String>)> {
        const ID: &str = "poe1.divination-cards";
        let mut stale_error = None;
        if force || store::installed(&self.db, ID)?.is_none() {
            match self.run(RunKind::Sync, "module", &[Group::GameData], Some(&[ID]), true).await {
                Ok(r) => {
                    if let Some(f) = r.failures.first() {
                        stale_error = Some(f.error.clone());
                    } else if r.staged.iter().any(|s| s["needsReview"] == true) {
                        stale_error = Some("An update is waiting for your review in the Update Center.".into());
                    }
                }
                Err(e) => stale_error = Some(e.to_string()),
            }
        }
        if store::installed(&self.db, ID)?.is_none() {
            if let Some(l) = legacy.filter(|l| l.cards.len() >= 100) {
                self.import_legacy_cards(l)?;
            }
        }
        let (v, entries) = store::installed_entries(&self.db, ID)?.ok_or_else(|| AppError::InvalidInput(format!("Couldn't download the Divination Card list: {}", stale_error.clone().unwrap_or_else(|| "no data".into()))))?;
        Ok((v, entries.iter().map(card_from_entry).collect(), stale_error))
    }

    fn import_legacy_cards(&self, l: crate::decks::cards::CardDb) -> AppResult<()> {
        let def = registry::dataset("poe1.divination-cards").expect("registered");
        let entries: Vec<Entry> = l.cards.into_iter().map(providers::card_entry).collect();
        let meta = registry::provider(def.provider_id).expect("registered");
        let outcome = validate::validate(def, &entries, 0, None, meta.reliability);
        if outcome.result == Validation::Failed {
            return Ok(());
        }
        let now = unix_now();
        let hash = hash_entries(&entries);
        let check_id = store::start_check(&self.db, "apply", "module", now)?;
        let v = store::NewVersion {
            dataset_id: def.id,
            game: def.game,
            league: None,
            format: def.format,
            label: hash[..8].to_string(),
            content_hash: hash.clone(),
            entries: &entries,
            provider_id: def.provider_id,
            source_url: Some(providers::REPOE_BASE_ITEMS),
            source_version: l.source_modified.as_deref(),
            retrieved_at: l.checked_at,
            now,
            origin: "imported",
            validation: outcome.result,
            notes: &outcome.notes,
            parent_id: None,
            check_id: Some(check_id),
        };
        let (id, _) = store::insert_and_install(&self.db, &v, &[], now)?;
        self.after_install(def, id, None, &entries, check_id, "imported", "Deck Intelligence's earlier card cache".into(), now);
        store::finish_check(&self.db, check_id, "ok", &json!({ "imported": id }), now)?;
        Ok(())
    }

    // ---------- scheduler ----------

    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let _ = self.app.set(app);
        if let Ok(n) = store::mark_interrupted(&self.db, unix_now()) {
            if n > 0 {
                let _ = store::event(&self.db, store::NewEvent { kind: "interrupted", status: "warning", message: format!("{n} run(s) were interrupted when Vaalytics last closed; installed data was not affected."), ..Default::default() }, unix_now());
            }
        }
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            let mut first = true;
            loop {
                let next = this.scheduled_tick(first).await;
                first = false;
                match next {
                    Some(at) => {
                        let wait = (at - unix_now()).clamp(60, 7 * 86_400) as u64;
                        let _ = tokio::time::timeout(Duration::from_secs(wait), this.wake.notified()).await;
                    }
                    None => this.wake.notified().await,
                }
            }
        });
    }

    /// Runs due groups; returns when the next group is due (None = nothing scheduled).
    async fn scheduled_tick(self: &Arc<Self>, startup: bool) -> Option<i64> {
        let s = self.settings();
        let now = unix_now();
        let mut due = Vec::new();
        let mut next: Option<i64> = None;
        for (group, mode) in [(Group::GameData, &s.schedules.game_data), (Group::Leagues, &s.schedules.leagues), (Group::PatchNotes, &s.schedules.patch_notes)] {
            if mode == "startup" {
                if startup {
                    due.push(group);
                }
                continue;
            }
            let Some(interval) = schedule_interval(mode) else { continue };
            let at = self.due_at(group, interval);
            if at <= now {
                due.push(group);
            } else {
                next = Some(next.map_or(at, |n: i64| n.min(at)));
            }
        }
        if due.is_empty() {
            return next;
        }
        let kind = if s.auto_apply { RunKind::Sync } else { RunKind::Check };
        let trigger = if startup { "startup" } else { "schedule" };
        let result = self.run(kind, trigger, &due, None, false).await;
        if let Ok(mut a) = self.attempts.lock() {
            for g in &due {
                let failed = match &result {
                    Ok(r) => !r.failures.is_empty(),
                    Err(_) => false, // busy: another run covers it
                };
                let e = a.entry(group_key(*g)).or_insert((0, 0));
                *e = (unix_now(), if failed { e.1 + 1 } else { 0 });
            }
        }
        // Recompute after the run.
        let now = unix_now();
        [(Group::GameData, &s.schedules.game_data), (Group::Leagues, &s.schedules.leagues), (Group::PatchNotes, &s.schedules.patch_notes)]
            .iter()
            .filter_map(|(g, m)| schedule_interval(m).map(|i| self.due_at(*g, i)))
            .map(|at| at.max(now + 60))
            .min()
    }

    /// Next due time: interval after the last success, with retry backoff after failures.
    fn due_at(&self, group: Group, interval: i64) -> i64 {
        let last_ok = match group {
            Group::PatchNotes => store::source_state(&self.db, "ggg-patch-notes").ok().and_then(|s| s.last_success_at),
            _ => registry::DATASETS
                .iter()
                .filter(|d| d.group == group && d.kind == DatasetKind::Versioned)
                .map(|d| store::dataset_state(&self.db, d.id).ok().and_then(|s| s.last_checked_at).unwrap_or(0))
                .min(),
        }
        .unwrap_or(0);
        let mut at = last_ok + interval;
        if let Some((attempt, failures)) = self.attempts.lock().ok().and_then(|a| a.get(group_key(group)).copied()) {
            if failures > 0 {
                // 15 min, 30 min, 1 h … capped at the interval.
                let backoff = (900_i64 << (failures - 1).min(6)).min(interval);
                at = at.max(attempt + backoff).min(attempt + interval);
            } else {
                at = at.max(attempt + interval.min(3600));
            }
        }
        at
    }
}

pub fn card_from_entry(e: &Entry) -> crate::decks::cards::Card {
    let d = &e.data;
    crate::decks::cards::Card {
        name: e.name.clone(),
        stack_size: d.get("stackSize").and_then(Value::as_u64).map(|n| n as u32),
        reward: d.get("reward").and_then(Value::as_str).unwrap_or_default().to_string(),
        reward_kind: d.get("rewardKind").and_then(Value::as_str).unwrap_or_default().to_string(),
        drop_level: d.get("dropLevel").and_then(Value::as_u64).map(|n| n as u32),
        legacy: d.get("legacy").and_then(Value::as_bool).unwrap_or(false),
    }
}

/// Installed card names without network (Deck Intelligence's matcher).
pub fn installed_card_names(db: &Database) -> Option<Vec<String>> {
    store::installed_entries(db, "poe1.divination-cards").ok().flatten().map(|(_, e)| e.into_iter().map(|e| e.name).collect())
}

#[cfg(test)]
mod tests;
