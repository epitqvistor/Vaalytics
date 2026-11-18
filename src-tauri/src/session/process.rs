//! Game process detection. Reads the process list (name, executable path,
//! start time) and top-level window titles — no process memory access, no
//! injection, no handles kept open. The source is a trait so the tracker can be
//! tested without a real game.

use crate::game::GameId;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub exe: Option<PathBuf>,
    /// Unix seconds.
    pub started_at: i64,
    /// Game named by a window this process owns (`Path of Exile 2` title).
    pub window_game: Option<GameId>,
}

pub trait ProcessSource: Send {
    /// Path of Exile client processes currently running (any game).
    fn scan(&mut self) -> Result<Vec<ProcInfo>, String>;
}

/// Executable names shipped by the PoE clients (standalone, Steam, Epic,
/// Kakao; 64-bit variants). PoE 1 and PoE 2 use the same names.
pub fn is_client_exe(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let Some(stem) = n.strip_suffix(".exe") else { return false };
    matches!(
        stem,
        "pathofexile" | "pathofexile_x64" | "pathofexilesteam" | "pathofexile_x64steam" | "pathofexileegs" | "pathofexile_x64egs" | "pathofexile_kg" | "pathofexile_x64_kg"
    )
}

/// Decides whether a client process is PoE 2: its window title says so, or its
/// executable lives in a `Path of Exile 2` folder, or in the folder that holds
/// the configured `logs/Client.txt`.
pub fn is_poe2(p: &ProcInfo, log_path: Option<&Path>) -> bool {
    match p.window_game {
        Some(GameId::Poe2) => return true,
        Some(GameId::Poe1) => return false,
        None => {}
    }
    let Some(exe) = p.exe.as_deref() else { return false };
    let Some(dir) = exe.parent() else { return false };
    if let Some(game_dir) = log_path.and_then(|l| l.parent()).and_then(|logs| logs.parent()) {
        if same_path(dir, game_dir) {
            return true;
        }
    }
    dir.components().any(|c| {
        let s = c.as_os_str().to_string_lossy().to_ascii_lowercase();
        s == "path of exile 2" || s == "pathofexile2"
    })
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches(['\\', '/']))
}

/// The PoE 2 client to track: the earliest started one.
pub fn pick_poe2(procs: &[ProcInfo], log_path: Option<&Path>) -> Option<ProcInfo> {
    procs.iter().filter(|p| is_poe2(p, log_path)).min_by_key(|p| (p.started_at, p.pid)).cloned()
}

/// Real process list via `sysinfo` (already used by Diagnostics).
pub struct SystemProcesses {
    sys: Option<sysinfo::System>,
}

impl SystemProcesses {
    pub fn new() -> Self {
        Self { sys: sysinfo::System::new().map_err(|e| log::warn!("process list unavailable: {e}")).ok() }
    }
}

impl ProcessSource for SystemProcesses {
    fn scan(&mut self) -> Result<Vec<ProcInfo>, String> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
        let sys = self.sys.as_mut().ok_or("The process list is unavailable on this system.")?;
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
        #[cfg(windows)]
        let windows = crate::overlay::win::game_window_pids();
        #[cfg(not(windows))]
        let windows: Vec<(u32, GameId)> = Vec::new();
        Ok(sys
            .processes()
            .values()
            .filter(|p| is_client_exe(&p.name().to_string_lossy()))
            .map(|p| {
                let pid = p.pid().as_u32();
                ProcInfo {
                    pid,
                    name: p.name().to_string_lossy().into_owned(),
                    exe: p.exe().map(Path::to_path_buf),
                    started_at: p.start_time() as i64,
                    window_game: windows.iter().find(|(wp, _)| *wp == pid).map(|(_, g)| *g),
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, exe: &str, started_at: i64, window_game: Option<GameId>) -> ProcInfo {
        ProcInfo { pid, name: Path::new(exe).file_name().unwrap().to_string_lossy().into(), exe: Some(exe.into()), started_at, window_game }
    }

    #[test]
    fn recognises_client_executables() {
        for n in ["PathOfExile.exe", "PathOfExile_x64.exe", "PathOfExileSteam.exe", "pathofexile_x64steam.EXE", "PathOfExileEGS.exe"] {
            assert!(is_client_exe(n), "{n}");
        }
        for n in ["PathOfBuilding.exe", "PathOfExile", "explorer.exe", "PathOfExile2Launcher.exe"] {
            assert!(!is_client_exe(n), "{n}");
        }
    }

    #[test]
    fn tells_poe2_from_poe1() {
        let steam2 = proc(1, r"D:\STEAM\steamapps\common\Path of Exile 2\PathOfExileSteam.exe", 10, None);
        let steam1 = proc(2, r"D:\STEAM\steamapps\common\Path of Exile\PathOfExileSteam.exe", 5, None);
        let custom = proc(3, r"E:\Games\PoE2\PathOfExile.exe", 7, None);
        assert!(is_poe2(&steam2, None));
        assert!(!is_poe2(&steam1, None));
        assert!(!is_poe2(&custom, None), "unknown folder, no window yet");
        assert!(is_poe2(&custom, Some(Path::new(r"E:\Games\PoE2\logs\Client.txt"))), "folder of the configured log");
        let titled = ProcInfo { window_game: Some(GameId::Poe2), ..custom.clone() };
        assert!(is_poe2(&titled, None), "window title wins");
        let poe1_window = ProcInfo { window_game: Some(GameId::Poe1), ..steam2.clone() };
        assert!(!is_poe2(&poe1_window, None));
        let no_exe = ProcInfo { exe: None, ..custom };
        assert!(!is_poe2(&no_exe, None));
    }

    #[test]
    fn picks_the_earliest_poe2_client() {
        let a = proc(8, r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\PathOfExile.exe", 300, None);
        let b = proc(4, r"D:\STEAM\steamapps\common\Path of Exile 2\PathOfExileSteam.exe", 200, None);
        let c = proc(2, r"D:\STEAM\steamapps\common\Path of Exile\PathOfExileSteam.exe", 100, None);
        assert_eq!(pick_poe2(&[a, b.clone(), c.clone()], None), Some(b));
        assert_eq!(pick_poe2(&[c], None), None);
    }
}
