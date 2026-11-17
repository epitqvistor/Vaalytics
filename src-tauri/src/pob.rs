//! Path of Building integration: detect, validate and launch the official
//! Path of Building Community builds (PoE 1: PathOfBuilding, PoE 2:
//! PathOfBuilding-PoE2). Vaalytics never bundles, modifies or silently installs
//! Path of Building — see docs/modules/path-of-building.md.
//!
//! Security model: the frontend never supplies an executable path to run.
//! Candidates come from the Windows uninstall registry, a scan of common
//! folders, or a native file dialog opened by this module. Every candidate must
//! sit next to a PoB `manifest.xml` whose source URL names the expected
//! repository, so the PoE 1 button can never start PoE 2's PoB (or anything else).

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::settings;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

const KEY_EXE: &str = "pob.exePath";
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_BUILDS: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PobInstall {
    pub exe: String,
    pub dir: String,
    pub version: Option<String>,
    pub branch: Option<String>,
    /// "configured" | "registry" | "scan"
    pub source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PobStatus {
    pub game: GameId,
    pub product: &'static str,
    pub install: Option<PobInstall>,
    /// A configured path that no longer validates (moved/uninstalled/wrong game).
    pub configured_problem: Option<String>,
    pub running: bool,
    pub builds_dir: Option<String>,
    pub download_url: &'static str,
    pub project_url: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PobBuild {
    pub name: String,
    /// Path relative to the builds folder (folders are shown as groups).
    pub folder: String,
    pub modified: Option<i64>,
    pub size: u64,
}

pub fn product(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "Path of Building Community",
        GameId::Poe2 => "Path of Building (PoE 2)",
    }
}

fn repo_marker(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "PathOfBuildingCommunity/PathOfBuilding/",
        GameId::Poe2 => "PathOfBuildingCommunity/PathOfBuilding-PoE2/",
    }
}

pub fn download_url(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "https://github.com/PathOfBuildingCommunity/PathOfBuilding/releases/latest",
        GameId::Poe2 => "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases/latest",
    }
}

fn project_url(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "https://pathofbuilding.community/",
        GameId::Poe2 => "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2",
    }
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let key = format!("{name}=\"");
    let start = tag.find(&key)? + key.len();
    let end = tag[start..].find('"')?;
    Some(tag[start..start + end].to_owned())
}

/// Reads a PoB manifest: which game it belongs to, its version and branch.
pub fn identify_manifest(xml: &str) -> Option<(GameId, Option<String>, Option<String>)> {
    // PoE 2's repository name contains PoE 1's as a prefix, so test it first.
    let game = if xml.contains(repo_marker(GameId::Poe2)) {
        GameId::Poe2
    } else if xml.contains(repo_marker(GameId::Poe1)) {
        GameId::Poe1
    } else {
        return None;
    };
    let version_tag = xml.find("<Version").and_then(|i| xml[i..].find('>').map(|j| &xml[i..i + j]));
    let version = version_tag.and_then(|t| attr(t, "number"));
    let branch = version_tag.and_then(|t| attr(t, "branch"));
    Some((game, version, branch))
}

fn identify_dir(dir: &Path) -> Option<(GameId, Option<String>, Option<String>)> {
    let path = dir.join("manifest.xml");
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    identify_manifest(&std::fs::read_to_string(path).ok()?)
}

fn is_helper_exe(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "update.exe" || n.starts_with("uninst") || n.contains("crashpad")
}

/// The PoB executable inside an install folder.
fn find_exe(dir: &Path) -> Option<PathBuf> {
    let mut exes: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| !is_helper_exe(n)))
        .collect();
    exes.sort_by_key(|p| !p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("Path of Building")));
    exes.into_iter().next()
}

/// Validates an executable for `game`. Returns a user-facing reason on failure.
pub fn validate_exe(exe: &Path, game: GameId) -> Result<(Option<String>, Option<String>), String> {
    let name = exe.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if !exe.is_file() || !exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        return Err("The selected file is not an executable that exists.".into());
    }
    if is_helper_exe(name) {
        return Err(format!("“{name}” is a Path of Building helper. Select the main Path of Building executable."));
    }
    let dir = exe.parent().ok_or("Invalid location.")?;
    match identify_dir(dir) {
        Some((g, version, branch)) if g == game => Ok((version, branch)),
        Some((other, ..)) => Err(format!("This is {} — select {} for this game.", product(other), product(game))),
        None => Err("No Path of Building manifest found next to this file. Select the executable inside the Path of Building folder.".into()),
    }
}

fn install_from_dir(dir: &Path, game: GameId, source: &'static str) -> Option<PobInstall> {
    let (g, version, branch) = identify_dir(dir)?;
    if g != game {
        return None;
    }
    let exe = find_exe(dir)?;
    Some(PobInstall { exe: exe.to_string_lossy().into_owned(), dir: dir.to_string_lossy().into_owned(), version, branch, source })
}

#[cfg(windows)]
fn registry_dirs() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let mut out = Vec::new();
    let roots = [
        (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (hive, path) in roots {
        let Ok(key) = RegKey::predef(hive).open_subkey(path) else { continue };
        for sub in key.enum_keys().flatten() {
            let Ok(app) = key.open_subkey(&sub) else { continue };
            let name: String = app.get_value("DisplayName").unwrap_or_default();
            if !name.contains("Path of Building") {
                continue;
            }
            for field in ["InstallLocation", "DisplayIcon"] {
                let raw: String = app.get_value(field).unwrap_or_default();
                let cleaned = raw.trim().trim_matches('"');
                let cleaned = cleaned.split(",").next().unwrap_or(cleaned).trim_matches('"');
                if cleaned.is_empty() {
                    continue;
                }
                let p = PathBuf::from(cleaned);
                out.push(if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) { p.parent().map(Path::to_path_buf).unwrap_or(p) } else { p });
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn registry_dirs() -> Vec<PathBuf> {
    Vec::new()
}

fn scan_roots(documents: Option<&Path>) -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut roots: Vec<PathBuf> = [env("APPDATA"), env("LOCALAPPDATA"), env("LOCALAPPDATA").map(|p| p.join("Programs")), env("ProgramFiles"), env("ProgramFiles(x86)")]
        .into_iter()
        .flatten()
        .collect();
    if let Some(d) = documents {
        roots.push(d.to_path_buf());
    }
    roots
}

fn scan_dirs(documents: Option<&Path>) -> Vec<PathBuf> {
    scan_roots(documents)
        .into_iter()
        .filter_map(|root| std::fs::read_dir(root).ok())
        .flat_map(|rd| rd.flatten())
        .filter(|e| e.file_name().to_string_lossy().starts_with("Path of Building") && e.path().is_dir())
        .map(|e| e.path())
        .collect()
}

pub struct PobService {
    launched: Mutex<Option<(GameId, Instant)>>,
}

impl PobService {
    pub fn new() -> Self {
        Self { launched: Mutex::new(None) }
    }

    fn configured(&self, db: &Database, game: GameId) -> Option<PathBuf> {
        settings::get_game(db, game, KEY_EXE).ok().flatten().and_then(|v| v.as_str().map(PathBuf::from))
    }

    pub fn detect(&self, db: &Database, game: GameId, documents: Option<&Path>) -> (Option<PobInstall>, Option<String>) {
        let mut problem = None;
        if let Some(exe) = self.configured(db, game) {
            match validate_exe(&exe, game) {
                Ok((version, branch)) => {
                    let dir = exe.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
                    return (Some(PobInstall { exe: exe.to_string_lossy().into_owned(), dir, version, branch, source: "configured" }), None);
                }
                Err(e) => problem = Some(format!("Saved path is no longer valid: {e}")),
            }
        }
        for dir in registry_dirs() {
            if let Some(i) = install_from_dir(&dir, game, "registry") {
                return (Some(i), problem);
            }
        }
        for dir in scan_dirs(documents) {
            if let Some(i) = install_from_dir(&dir, game, "scan") {
                return (Some(i), problem);
            }
        }
        (None, problem)
    }

    pub fn status(&self, db: &Database, game: GameId, documents: Option<&Path>) -> PobStatus {
        let (install, configured_problem) = self.detect(db, game, documents);
        let running = install.as_ref().is_some_and(|i| is_running(Path::new(&i.exe)));
        PobStatus {
            game,
            product: product(game),
            builds_dir: builds_dir(game, documents).map(|p| p.to_string_lossy().into_owned()),
            install,
            configured_problem,
            running,
            download_url: download_url(game),
            project_url: project_url(game),
        }
    }

    pub fn set_path(&self, db: &Database, game: GameId, exe: &Path) -> AppResult<()> {
        validate_exe(exe, game).map_err(AppError::InvalidInput)?;
        settings::set_game(db, game, KEY_EXE, &serde_json::Value::from(exe.to_string_lossy().into_owned()))
    }

    pub fn clear_path(&self, db: &Database, game: GameId) -> AppResult<()> {
        settings::set_game(db, game, KEY_EXE, &serde_json::Value::Null)
    }

    pub fn launch(&self, db: &Database, game: GameId, documents: Option<&Path>) -> AppResult<()> {
        let (install, _) = self.detect(db, game, documents);
        let install = install.ok_or_else(|| AppError::InvalidInput(format!("{} was not found. Detect it again or choose its executable.", product(game))))?;
        let exe = PathBuf::from(&install.exe);
        validate_exe(&exe, game).map_err(AppError::InvalidInput)?;
        {
            let mut last = self.launched.lock().map_err(|_| AppError::StatePoisoned)?;
            if let Some((g, at)) = *last {
                if g == game && at.elapsed() < Duration::from_secs(8) {
                    return Err(AppError::InvalidInput(format!("{} is starting…", product(game))));
                }
            }
            if is_running(&exe) {
                return Err(AppError::InvalidInput(format!("{} is already running.", product(game))));
            }
            std::process::Command::new(&exe)
                .current_dir(&install.dir)
                .spawn()
                .map_err(|e| AppError::InvalidInput(format!("Could not start {}: {e}", product(game))))?;
            *last = Some((game, Instant::now()));
        }
        log::info!("launched {} ({})", product(game), install.exe);
        Ok(())
    }
}

fn is_running(exe: &Path) -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let Ok(mut sys) = System::new() else { return false };
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    let target = exe.to_string_lossy().to_ascii_lowercase();
    sys.processes().values().any(|p| p.exe().is_some_and(|e| e.to_string_lossy().to_ascii_lowercase() == target))
}

/// PoB's default builds folder, honouring a custom `buildPath` in its Settings.xml.
pub fn builds_dir(game: GameId, documents: Option<&Path>) -> Option<PathBuf> {
    let base = documents?.join(match game {
        GameId::Poe1 => "Path of Building",
        GameId::Poe2 => "Path of Building (PoE2)",
    });
    let custom = std::fs::read_to_string(base.join("Settings.xml")).ok().and_then(|xml| {
        let i = xml.find("buildPath=\"")?;
        let tag_start = xml[..i].rfind('<')?;
        attr(&xml[tag_start..], "buildPath")
    });
    let dir = custom.map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(|| base.join("Builds"));
    dir.is_dir().then_some(dir)
}

pub fn list_builds(dir: &Path) -> Vec<PobBuild> {
    let mut out = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), String::new(), 0)];
    while let Some((path, rel, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&path) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() && depth < 3 {
                stack.push((p, if rel.is_empty() { name } else { format!("{rel}/{name}") }, depth + 1));
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("xml")) {
                let meta = e.metadata().ok();
                out.push(PobBuild {
                    name: name.trim_end_matches(".xml").to_owned(),
                    folder: rel.clone(),
                    modified: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64),
                    size: meta.map(|m| m.len()).unwrap_or(0),
                });
                if out.len() >= MAX_BUILDS {
                    return out;
                }
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const POE1: &str = r#"<?xml version='1.0' encoding='UTF-8'?>
<PoBVersion>
	<Version number="2.67.2" />
	<Source part="default" url="https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/{branch}/" />"#;
    const POE2: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<PoBVersion>
	<Version branch="beta" number="0.22.0-818cc5ef4" platform="win32"/>
	<Source url="https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/{branch}/src/" part="program"/>"#;

    #[test]
    fn identifies_game_version_and_branch() {
        assert_eq!(identify_manifest(POE1), Some((GameId::Poe1, Some("2.67.2".into()), None)));
        assert_eq!(identify_manifest(POE2), Some((GameId::Poe2, Some("0.22.0-818cc5ef4".into()), Some("beta".into()))));
        assert_eq!(identify_manifest("<PoBVersion/>"), None);
    }

    #[test]
    fn validates_exe_against_manifest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("manifest.xml"), POE2).unwrap();
        let exe = dir.path().join("Path of Building-PoE2.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        std::fs::write(dir.path().join("Update.exe"), b"MZ").unwrap();
        assert!(validate_exe(&exe, GameId::Poe2).is_ok());
        assert!(validate_exe(&exe, GameId::Poe1).unwrap_err().contains("Path of Building (PoE 2)"));
        assert!(validate_exe(&dir.path().join("Update.exe"), GameId::Poe2).is_err());
        assert!(validate_exe(&dir.path().join("missing.exe"), GameId::Poe2).is_err());
        let found = install_from_dir(dir.path(), GameId::Poe2, "scan").unwrap();
        assert!(found.exe.ends_with("Path of Building-PoE2.exe"), "helper executables are skipped");
    }

    #[test]
    fn lists_builds_newest_first_with_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("League")).unwrap();
        std::fs::write(dir.path().join("Old.xml"), "<x/>").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.path().join("League").join("New.xml"), "<x/>").unwrap();
        std::fs::write(dir.path().join("notes.txt"), "").unwrap();
        let b = list_builds(dir.path());
        assert_eq!(b.len(), 2);
        assert!(b.iter().any(|x| x.name == "New" && x.folder == "League"));
    }
}
