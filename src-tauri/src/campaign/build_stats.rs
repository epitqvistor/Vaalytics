//! Reads a few planned-build numbers from a Path of Building (PoE 2) build file
//! for build-aware campaign hints. Read-only; the file must lie inside the PoB
//! builds folder computed in Rust (the frontend only sends a relative name).
//! Verified on real PoB PoE 2 build files: `<Build className=… ascendClassName=…
//! level=…>` and `<PlayerStat stat="…" value="…"/>` (attribute order varies).

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

const MAX_BYTES: u64 = 8 * 1024 * 1024;
const KEEP: &[&str] = &[
    "Spirit", "SpiritUnreserved", "Life", "Mana", "EnergyShield", "FireResist", "ColdResist", "LightningResist", "ChaosResist", "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildStats {
    pub name: String,
    pub class_name: Option<String>,
    pub ascend_class_name: Option<String>,
    pub level: Option<u32>,
    pub stats: BTreeMap<String, f64>,
}

/// `rel` = "folder/name" as listed by `pob_builds` (folder may be empty).
pub fn read(dir: &Path, rel: &str) -> AppResult<BuildStats> {
    let bad = || AppError::InvalidInput("Unknown build.".into());
    if rel.is_empty() || rel.len() > 260 || rel.contains("..") || rel.contains('\\') || rel.contains(':') || rel.starts_with('/') {
        return Err(bad());
    }
    let path = dir.join(format!("{rel}.xml"));
    let root = dir.canonicalize().map_err(|_| bad())?;
    let real = path.canonicalize().map_err(|_| bad())?;
    if !real.starts_with(&root) || !real.is_file() {
        return Err(bad());
    }
    if std::fs::metadata(&real)?.len() > MAX_BYTES {
        return Err(AppError::InvalidInput("The build file is too large.".into()));
    }
    let text = String::from_utf8_lossy(&std::fs::read(&real)?).into_owned();
    let mut out = parse(&text);
    out.name = rel.rsplit('/').next().unwrap_or(rel).to_string();
    Ok(out)
}

pub fn parse(xml: &str) -> BuildStats {
    let mut out = BuildStats { name: String::new(), class_name: None, ascend_class_name: None, level: None, stats: BTreeMap::new() };
    if let Some(tag) = find_tag(xml, "<Build ") {
        out.class_name = attr(tag, "className").filter(|s| !s.is_empty());
        out.ascend_class_name = attr(tag, "ascendClassName").filter(|s| !s.is_empty() && s != "None");
        out.level = attr(tag, "level").and_then(|s| s.parse().ok());
    }
    let mut rest = xml;
    while let Some(i) = rest.find("<PlayerStat ") {
        let tail = &rest[i..];
        let end = tail.find('>').unwrap_or(tail.len());
        let tag = &tail[..end];
        if let (Some(stat), Some(value)) = (attr(tag, "stat"), attr(tag, "value").and_then(|v| v.parse::<f64>().ok())) {
            if KEEP.contains(&stat.as_str()) && value.is_finite() {
                out.stats.entry(stat).or_insert(value); // first occurrence = main skill's stats
            }
        }
        rest = &tail[end..];
    }
    out
}

fn find_tag<'a>(xml: &'a str, open: &str) -> Option<&'a str> {
    let i = xml.find(open)?;
    let tail = &xml[i..];
    Some(&tail[..tail.find('>')?])
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let key = format!(" {name}=\"");
    let i = tag.find(&key)? + key.len();
    let j = tag[i..].find('"')? + i;
    Some(tag[i..j].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shapes from real PoB PoE 2 build files (values changed).
    const XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
	<Build targetVersion="0_1" level="88" ascendClassName="Pathfinder" characterLevelAutoMode="false" mainSocketGroup="7" className="Ranger" viewMode="CONFIG">
		<PlayerStat value="9006.83" stat="AverageDamage"/>
		<PlayerStat stat="Spirit" value="250"/>
		<PlayerStat value="26" stat="SpiritUnreserved"/>
		<PlayerStat stat="ColdResist" value="61"/>
		<PlayerStat stat="ReqInt" value="157"/>
		<PlayerStat stat="Int" value="140"/>
		<PlayerStat stat="Spirit" value="999"/>
	</Build>
</PathOfBuilding2>"#;

    #[test]
    fn parses_build_header_and_known_stats_only() {
        let b = parse(XML);
        assert_eq!(b.class_name.as_deref(), Some("Ranger"));
        assert_eq!(b.ascend_class_name.as_deref(), Some("Pathfinder"));
        assert_eq!(b.level, Some(88));
        assert_eq!(b.stats.get("Spirit"), Some(&250.0));
        assert_eq!(b.stats.get("SpiritUnreserved"), Some(&26.0));
        assert_eq!(b.stats.get("ReqInt"), Some(&157.0));
        assert!(!b.stats.contains_key("AverageDamage"));
    }

    #[test]
    fn only_files_inside_the_builds_folder_can_be_read() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Builds");
        std::fs::create_dir_all(dir.join("Sub")).unwrap();
        std::fs::write(dir.join("Sub").join("My Build.xml"), XML).unwrap();
        std::fs::write(tmp.path().join("outside.xml"), XML).unwrap();
        assert_eq!(read(&dir, "Sub/My Build").unwrap().name, "My Build");
        for bad in ["../outside", "C:/Windows/win", r"Sub\My Build", "/etc/x", "", "Missing"] {
            assert!(read(&dir, bad).is_err(), "{bad}");
        }
    }
}
