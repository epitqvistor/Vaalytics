//! Finds and validates the PoE 2 `Client.txt`. Discovery only looks at known
//! install locations; nothing is launched or written.

use super::log_format::parse_stamp;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Signatures found in real logs: PoE 2 writes `User agent: PoE poe2_production…`
/// and connects to `*.login.pathofexile2.com`; PoE 1 writes `PoE release` and
/// `*.login.pathofexile.com`.
const POE2_MARKS: [&[u8]; 2] = [b"poe2_production", b"login.pathofexile2.com"];
const POE1_MARKS: [&[u8]; 2] = [b"User agent: PoE release", b"login.pathofexile.com"];
const SIGNATURE_WINDOW: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogCheck {
    /// Looks like a PoE 2 client log.
    Poe2,
    /// A client log without a game signature yet (new or very short).
    Unconfirmed,
}

/// Validates a candidate log: an existing regular `.txt` file whose first line
/// is a client log line and that isn't a PoE 1 log.
pub fn validate(path: &Path) -> Result<LogCheck, String> {
    let ext_ok = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt"));
    if !ext_ok {
        return Err("Choose the game's log file (Client.txt).".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "The file can't be found or opened.".to_string())?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    let mut f = std::fs::File::open(path).map_err(|_| "The file can't be opened for reading.".to_string())?;
    let mut head = [0u8; 64];
    let n = f.read(&mut head).map_err(|_| "The file can't be read.".to_string())?;
    if n > 0 && parse_stamp(&String::from_utf8_lossy(&head[..n])).is_none() {
        return Err("This doesn't look like a Path of Exile log (Client.txt).".into());
    }
    let size = meta.len();
    let from = size.saturating_sub(SIGNATURE_WINDOW);
    f.seek(SeekFrom::Start(from)).map_err(|_| "The file can't be read.".to_string())?;
    let mut tail = Vec::new();
    f.take(SIGNATURE_WINDOW).read_to_end(&mut tail).map_err(|_| "The file can't be read.".to_string())?;
    let has = |marks: &[&[u8]]| marks.iter().any(|m| tail.windows(m.len()).any(|w| w == *m));
    if has(&POE2_MARKS) {
        Ok(LogCheck::Poe2)
    } else if has(&POE1_MARKS) {
        Err("This is a Path of Exile 1 log. Choose the Client.txt inside the Path of Exile 2 folder.".into())
    } else {
        Ok(LogCheck::Unconfirmed)
    }
}

/// `<game dir>/logs/Client.txt` for a running client's executable.
pub fn from_exe(exe: &Path) -> Option<PathBuf> {
    let p = exe.parent()?.join("logs").join("Client.txt");
    p.is_file().then_some(p)
}

/// `"path"  "D:\\STEAM"` lines of Steam's libraryfolders.vdf.
pub fn steam_library_paths(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|l| {
            let t = l.trim();
            let rest = t.strip_prefix("\"path\"")?.trim();
            let v = rest.strip_prefix('"')?.strip_suffix('"')?;
            Some(PathBuf::from(v.replace("\\\\", "\\")))
        })
        .collect()
}

#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam").ok()?;
    let p: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(p.replace('/', "\\")))
}

#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    None
}

/// Known install locations, in order. Only existing files are returned.
pub fn candidates() -> Vec<PathBuf> {
    candidates_in("Path of Exile 2")
}

/// Path of Exile 1 logs in the usual install folders (Location Atlas).
pub fn poe1_candidates() -> Vec<PathBuf> {
    candidates_in("Path of Exile")
}

/// Whether a log's recent part carries a PoE 1 signature (`User agent: PoE release…`,
/// `login.pathofexile.com`) and no PoE 2 one.
pub fn is_poe1_log(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let Ok(meta) = f.metadata() else { return false };
    let from = meta.len().saturating_sub(SIGNATURE_WINDOW);
    let mut tail = Vec::new();
    if f.seek(SeekFrom::Start(from)).is_err() || f.take(SIGNATURE_WINDOW).read_to_end(&mut tail).is_err() {
        return false;
    }
    let has = |marks: &[&[u8]]| marks.iter().any(|m| tail.windows(m.len()).any(|w| w == *m));
    has(&POE1_MARKS) && !has(&POE2_MARKS)
}

fn candidates_in(folder: &str) -> Vec<PathBuf> {
    let mut libs: Vec<PathBuf> = Vec::new();
    if let Some(root) = steam_root() {
        if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
            libs.extend(steam_library_paths(&vdf));
        }
        libs.push(root);
    }
    let mut out: Vec<PathBuf> = libs
        .iter()
        .map(|l| l.join("steamapps").join("common").join(folder).join("logs").join("Client.txt"))
        .collect();
    for base in [r"C:\Program Files (x86)\Grinding Gear Games", r"C:\Program Files\Grinding Gear Games"] {
        out.push(Path::new(base).join(folder).join("logs").join("Client.txt"));
    }
    let mut seen = Vec::new();
    out.retain(|p| {
        let k = p.to_string_lossy().to_ascii_lowercase();
        let keep = p.is_file() && !seen.contains(&k);
        seen.push(k);
        keep
    });
    out
}

/// Short, non-identifying label for the normal UI (`…\Path of Exile 2\logs\Client.txt`).
pub fn masked(path: &Path) -> String {
    let parts: Vec<String> = path.components().rev().take(3).map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    format!("…\\{}", parts.into_iter().rev().collect::<Vec<_>>().join("\\"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steam_library_folders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\STEAM\"\n\t\t\"label\"\t\t\"\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"E:\\\\SteamLibrary\"\n\t}\n}";
        assert_eq!(steam_library_paths(vdf), vec![PathBuf::from(r"D:\STEAM"), PathBuf::from(r"E:\SteamLibrary")]);
    }

    #[test]
    fn validates_logs() {
        let dir = tempfile::tempdir().unwrap();
        let p2 = dir.path().join("Client.txt");
        std::fs::write(&p2, "2026/11/17 14:07:45 ***** LOG FILE OPENING *****\n2026/11/17 14:07:45 9078578 a1e2d5d9 [INFO Client 1] [HTTP2] User agent: PoE poe2_production/tags/0.5.5g Windows x64\n").unwrap();
        assert_eq!(validate(&p2), Ok(LogCheck::Poe2));
        let p1 = dir.path().join("Poe1.txt");
        std::fs::write(&p1, "2026/11/17 14:07:45 ***** LOG FILE OPENING *****\n2026/11/17 14:07:46 1 a [INFO Client 1] Async connecting to mil.login.pathofexile.com:20481\n").unwrap();
        assert!(validate(&p1).unwrap_err().contains("Path of Exile 1"));
        let fresh = dir.path().join("New.txt");
        std::fs::write(&fresh, "2026/11/17 14:07:45 ***** LOG FILE OPENING *****\n").unwrap();
        assert_eq!(validate(&fresh), Ok(LogCheck::Unconfirmed));
        let other = dir.path().join("notes.txt");
        std::fs::write(&other, "hello world, this is not a log file at all\n").unwrap();
        assert!(validate(&other).is_err());
        assert!(validate(&dir.path().join("missing.txt")).is_err());
        assert!(validate(&dir.path().join("Client.exe")).is_err());
        assert!(validate(dir.path()).is_err());
    }

    #[test]
    fn masks_paths() {
        assert_eq!(masked(Path::new(r"D:\Users\Someone\Games\Path of Exile 2\logs\Client.txt")), r"…\Path of Exile 2\logs\Client.txt");
    }
}
