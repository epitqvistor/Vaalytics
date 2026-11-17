//! Lightweight runtime diagnostics. Sampling happens only when requested (no
//! background polling), so diagnostics cost nothing while idle.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

pub struct Diagnostics {
    started: Instant,
    pid: Pid,
    system: Mutex<Option<System>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub app_version: &'static str,
    pub pid: u32,
    pub uptime_secs: u64,
    /// Resident memory of the Rust host process only.
    pub host_memory_bytes: u64,
    /// Host CPU usage since the previous sample (the first sample reads 0).
    pub host_cpu_percent: f32,
    /// WebView2 runs in separate msedgewebview2.exe processes owned by this app.
    pub webview_processes: usize,
    pub webview_memory_bytes: u64,
    pub webview_cpu_percent: f32,
    pub db_schema_version: i64,
    pub db_size_bytes: Option<u64>,
}

impl Diagnostics {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            pid: Pid::from_u32(std::process::id()),
            system: Mutex::new(
                System::new()
                    .map_err(|e| log::warn!("process diagnostics unavailable: {e}"))
                    .ok(),
            ),
        }
    }

    pub fn snapshot(&self, db: &Database) -> AppResult<DiagnosticsSnapshot> {
        let mut guard = self.system.lock().map_err(|_| AppError::StatePoisoned)?;
        let Some(sys) = guard.as_mut() else {
            return Err(AppError::InvalidInput("Process diagnostics are unavailable on this system.".into()));
        };
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
        let (host_mem, host_cpu) = sys
            .process(self.pid)
            .map(|p| (p.memory(), p.cpu_usage()))
            .unwrap_or((0, 0.0));

        // WebView2 processes descend from the host (browser process is a direct
        // child; renderers/GPU are children of the browser process).
        let (mut wv_count, mut wv_mem, mut wv_cpu) = (0usize, 0u64, 0f32);
        for p in sys.processes().values() {
            if !p.name().to_string_lossy().eq_ignore_ascii_case("msedgewebview2.exe") {
                continue;
            }
            let mut parent = p.parent();
            for _ in 0..4 {
                match parent {
                    Some(pp) if pp == self.pid => {
                        wv_count += 1;
                        wv_mem += p.memory();
                        wv_cpu += p.cpu_usage();
                        break;
                    }
                    Some(pp) => parent = sys.process(pp).and_then(|x| x.parent()),
                    None => break,
                }
            }
        }

        Ok(DiagnosticsSnapshot {
            app_version: env!("CARGO_PKG_VERSION"),
            pid: self.pid.as_u32(),
            uptime_secs: self.started.elapsed().as_secs(),
            host_memory_bytes: host_mem,
            host_cpu_percent: host_cpu,
            webview_processes: wv_count,
            webview_memory_bytes: wv_mem,
            webview_cpu_percent: wv_cpu,
            db_schema_version: db.schema_version()?,
            // WAL mode: recent writes live in the -wal file until checkpointed.
            db_size_bytes: db.path().map(|p| {
                ["", "-wal", "-shm"]
                    .iter()
                    .filter_map(|suffix| {
                        let mut f = p.as_os_str().to_owned();
                        f.push(suffix);
                        std::fs::metadata(f).ok()
                    })
                    .map(|m| m.len())
                    .sum()
            }),
        })
    }
}
