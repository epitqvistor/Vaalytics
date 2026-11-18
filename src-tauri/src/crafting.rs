//! Crafting data (PoE 1): base items, modifiers, fossils and essences from the
//! community RePoE export (https://repoe-fork.github.io, extracted from the
//! game files). Downloaded on demand, reduced to what the crafting calculator
//! needs and cached on disk. Refreshed at most once per day, with ETags.
//!
//! Spec: docs/modules/crafting.md

use crate::error::{AppError, AppResult};
use crate::game::GameId;
use reqwest::{header, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

const SOURCE_BASE: &str = "https://repoe-fork.github.io/";
const FILES: [&str; 6] = ["mods", "base_items", "fossils", "essences", "item_classes", "crafting_bench_options"];
/// Bump when the compact format changes; older caches are rebuilt.
const FORMAT_VERSION: u32 = 6;
const MAX_AGE_SECS: i64 = 24 * 3600;

/// Item classes the calculator supports (standard 3 prefix / 3 suffix gear).
/// Jewels, flasks and others use different rules and are not modelled.
pub const CLASSES: &[&str] = &[
    "Amulet", "Ring", "Belt", "Body Armour", "Helmet", "Gloves", "Boots", "Shield", "Quiver", "Bow", "Claw", "Dagger", "Rune Dagger",
    "One Hand Axe", "One Hand Mace", "One Hand Sword", "Thrusting One Hand Sword", "Sceptre", "Staff", "Warstaff", "Two Hand Axe",
    "Two Hand Mace", "Two Hand Sword", "Wand",
];

/// Fossils whose only effect is reweighting by tag. Others (added/forced mods,
/// corrupted essence mods, lucky rolls, sell-price mods) are excluded.
fn is_plain_fossil(v: &Value) -> bool {
    let empty = |k: &str| v.get(k).and_then(Value::as_array).is_none_or(|a| a.is_empty());
    empty("added_mods")
        && empty("forced_mods")
        && empty("sell_price_mods")
        && v.get("corrupted_essence_chance").and_then(Value::as_i64).unwrap_or(0) == 0
        && !v.get("rolls_lucky").and_then(Value::as_bool).unwrap_or(false)
        && !v.get("mirrors").and_then(Value::as_bool).unwrap_or(false)
        && !(empty("positive_mod_weights") && empty("negative_mod_weights"))
}

// ---------- compact format sent to the UI ----------

pub type TagWeights = Vec<(String, i64)>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDef {
    pub id: String,
    pub name: String,
    /// Tier family (RePoE `type`).
    pub family: String,
    /// Exclusion groups: only one mod per group on an item.
    pub groups: Vec<String>,
    /// "prefix" | "suffix"
    pub gen: String,
    pub level: i64,
    /// Tags used by fossils / harvest (RePoE `implicit_tags`).
    pub tags: Vec<String>,
    pub spawn: TagWeights,
    /// Extra multipliers in percent (first matching tag), RePoE `generation_weights`.
    pub gen_weights: TagWeights,
    pub text: String,
    pub essence_only: bool,
    /// Lines RePoE has no text for ("Socketed Gems are Supported by Level X …",
    /// "Grants Level X … Skill"), as keys like "support:reduced duration".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub display: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseDef {
    pub id: String,
    pub name: String,
    pub item_class: String,
    pub tags: Vec<String>,
    pub implicits: Vec<String>,
    pub drop_level: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassDef {
    pub id: String,
    pub name: String,
    /// RePoE order: crusader, elder, hunter (basilisk), redeemer (eyrie), shaper, warlord (adjudicator).
    pub influence_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FossilDef {
    pub id: String,
    pub name: String,
    /// Percent multipliers per tag (1000 = ×10, 0 = blocked).
    pub weights: TagWeights,
    pub allowed_tags: Vec<String>,
    pub forbidden_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EssenceDef {
    pub id: String,
    pub name: String,
    pub level: i64,
    pub item_level_restriction: Option<i64>,
    /// Item class → guaranteed mod id.
    pub mods: BTreeMap<String, String>,
}

/// Crafting bench recipe that adds an explicit (crafted) modifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchDef {
    pub mod_id: String,
    pub item_classes: Vec<String>,
    /// Currency name → amount.
    pub cost: Vec<(String, i64)>,
    pub tier: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftingData {
    pub format: u32,
    pub game: GameId,
    pub source: String,
    /// Unix seconds of the last successful check against the source.
    pub checked_at: i64,
    /// Source `Last-Modified` of mods.min.json, as sent.
    pub source_modified: Option<String>,
    pub classes: Vec<ClassDef>,
    pub bases: Vec<BaseDef>,
    pub mods: Vec<ModDef>,
    pub fossils: Vec<FossilDef>,
    pub essences: Vec<EssenceDef>,
    /// Bench crafts for the supported classes (metamods included).
    pub bench: Vec<BenchDef>,
    /// Crafted modifiers referenced by `bench`.
    pub crafted_mods: Vec<ModDef>,
    /// Veiled (unveiled at Jun) and Delve-only mods: used to recognise pasted
    /// items, never rolled.
    pub extra_mods: Vec<ModDef>,
    /// Texts for the in-game search (Regex module), English client.
    #[serde(default)]
    pub search: SearchData,
}

/// One searchable modifier: its text lines as RePoE renders them (translation markup removed).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMod {
    pub id: String,
    pub text: String,
    pub gen: String,
    /// Spawn tags with weight > 0 (e.g. "top_tier_map").
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchData {
    /// Area mods that roll on maps (any *_tier_map tag).
    pub map_mods: Vec<SearchMod>,
    /// Area mods of Expedition logbooks.
    pub logbook_mods: Vec<SearchMod>,
    pub flask_mods: Vec<SearchMod>,
    /// Jewel (misc) and abyss jewel mods.
    pub jewel_mods: Vec<SearchMod>,
    /// Cluster jewel (affliction) mods.
    pub cluster_mods: Vec<SearchMod>,
    /// Heist contract / blueprint area mods.
    pub heist_mods: Vec<SearchMod>,
    /// Released base names by item class (maps, flasks, jewels, tattoos, threads, heist…).
    pub bases: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftingDataResponse {
    pub data: CraftingData,
    /// Set when the refresh failed and cached data is returned.
    pub stale_error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CacheMeta {
    etags: HashMap<String, String>,
}

// ---------- building ----------

fn tag_weights(v: Option<&Value>) -> TagWeights {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|w| Some((w.get("tag")?.as_str()?.to_owned(), w.get("weight")?.as_i64()?)))
                .collect()
        })
        .unwrap_or_default()
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

/// Removes RePoE translation markup: "[PlayerItemRarity|Item Rarity]" → "Item Rarity", "[Life]" → "Life".
pub fn clean_text(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut rest = t;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else { break };
        out.push_str(&rest[..open]);
        let inner = &rest[open + 1..open + close];
        out.push_str(inner.rsplit('|').next().unwrap_or(inner));
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out
}

fn obj(v: &Value) -> AppResult<&Map<String, Value>> {
    v.as_object().ok_or_else(|| AppError::InvalidInput("Unexpected crafting data format.".into()))
}

fn mod_def(id: &str, m: &Value) -> ModDef {
    ModDef {
        id: id.to_owned(),
        name: m.get("name").and_then(Value::as_str).unwrap_or_default().to_owned(),
        family: m.get("type").and_then(Value::as_str).unwrap_or(id).to_owned(),
        groups: strings(m.get("groups")),
        gen: m.get("generation_type").and_then(Value::as_str).unwrap_or_default().to_owned(),
        level: m.get("required_level").and_then(Value::as_i64).unwrap_or(1),
        tags: strings(m.get("implicit_tags")),
        spawn: tag_weights(m.get("spawn_weights")),
        gen_weights: tag_weights(m.get("generation_weights")),
        text: clean_text(m.get("text").and_then(Value::as_str).unwrap_or_default()),
        essence_only: m.get("is_essence_only").and_then(Value::as_bool).unwrap_or(false),
        display: m
            .get("stats")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|st| display_key(st.get("id")?.as_str()?))
            .collect(),
    }
}

/// Key for a gem-support / granted-skill display stat, e.g.
/// "local_display_socketed_gems_supported_by_level_x_reduced_duration" → "support:reduced duration".
pub fn display_key(stat: &str) -> Option<String> {
    let s = stat.strip_prefix("local_display_").unwrap_or(stat);
    let strip_level = |t: &str| t.strip_suffix("_level").unwrap_or(t).replace('_', " ");
    for prefix in ["socketed_gems_supported_by_level_x_", "socketed_gems_supported_by_x_", "socketed_gems_get_"] {
        if let Some(tail) = s.strip_prefix(prefix) {
            return Some(format!("support:{}", strip_level(tail)));
        }
    }
    s.strip_prefix("grants_skill_").map(|tail| format!("grant:{}", strip_level(tail)))
}

/// Reduces the raw RePoE files to the compact crafting dataset.
pub fn build(raw: &HashMap<&str, Value>, checked_at: i64, source_modified: Option<String>) -> AppResult<CraftingData> {
    let get = |k: &str| raw.get(k).ok_or_else(|| AppError::InvalidInput(format!("missing {k}")));
    let all_mods = obj(get("mods")?)?;
    let classes_raw = obj(get("item_classes")?)?;
    let supported: HashSet<&str> = CLASSES.iter().copied().collect();

    let mut classes = Vec::new();
    for id in CLASSES {
        let c = classes_raw.get(*id);
        classes.push(ClassDef {
            id: (*id).to_owned(),
            name: c.and_then(|c| c.get("name")).and_then(Value::as_str).unwrap_or(id).to_owned(),
            influence_tags: strings(c.and_then(|c| c.get("influence_tags"))),
        });
    }

    let mut bases = Vec::new();
    for (id, b) in obj(get("base_items")?)? {
        let class = b.get("item_class").and_then(Value::as_str).unwrap_or_default();
        if b.get("domain").and_then(Value::as_str) != Some("item")
            || b.get("release_state").and_then(Value::as_str) != Some("released")
            || !supported.contains(class)
        {
            continue;
        }
        let implicits = strings(b.get("implicits"))
            .iter()
            .filter_map(|m| all_mods.get(m)?.get("text")?.as_str().map(clean_text))
            .filter(|t| !t.is_empty())
            .collect();
        bases.push(BaseDef {
            id: id.clone(),
            name: b.get("name").and_then(Value::as_str).unwrap_or_default().to_owned(),
            item_class: class.to_owned(),
            tags: strings(b.get("tags")),
            implicits,
            drop_level: b.get("drop_level").and_then(Value::as_i64).unwrap_or(1),
        });
    }
    // The same name can exist several times (variants); keep each once, lowest drop level first.
    bases.sort_by(|a, b| a.item_class.cmp(&b.item_class).then(a.drop_level.cmp(&b.drop_level)).then(a.name.cmp(&b.name)));
    let mut seen = HashSet::new();
    bases.retain(|b| seen.insert((b.item_class.clone(), b.name.clone(), b.implicits.clone())));

    let mut mods = Vec::new();
    let mut extra_mods = Vec::new();
    for (id, m) in all_mods {
        let gen = m.get("generation_type").and_then(Value::as_str).unwrap_or_default();
        if !(gen == "prefix" || gen == "suffix") {
            continue;
        }
        match m.get("domain").and_then(Value::as_str) {
            Some("item") => {}
            Some("unveiled" | "delve") => {
                extra_mods.push(mod_def(id, m));
                continue;
            }
            _ => continue,
        }
        // Zero-weight mods (Elevated, legacy) never roll; they are kept so pasted items are recognised.
        mods.push(mod_def(id, m));
    }
    mods.sort_by(|a, b| a.id.cmp(&b.id));
    extra_mods.sort_by(|a, b| a.id.cmp(&b.id));

    let mut fossils: Vec<FossilDef> = obj(get("fossils")?)?
        .iter()
        .filter(|(_, f)| f.get("name").and_then(Value::as_str).is_some_and(|n| n.ends_with(" Fossil")) && is_plain_fossil(f))
        .map(|(id, f)| {
            let mut weights = tag_weights(f.get("positive_mod_weights"));
            weights.extend(tag_weights(f.get("negative_mod_weights")));
            FossilDef {
                id: id.clone(),
                name: f.get("name").and_then(Value::as_str).unwrap_or_default().to_owned(),
                weights,
                allowed_tags: strings(f.get("allowed_tags")),
                forbidden_tags: strings(f.get("forbidden_tags")),
            }
        })
        .collect();
    fossils.sort_by(|a, b| a.name.cmp(&b.name));

    let mut essences: Vec<EssenceDef> = obj(get("essences")?)?
        .iter()
        .filter(|(_, e)| !e.pointer("/type/is_corruption_only").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|(id, e)| {
            let mods = e.get("mods")?.as_object()?.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned()))).collect();
            Some(EssenceDef {
                id: id.clone(),
                name: e.get("name")?.as_str()?.to_owned(),
                level: e.get("level").and_then(Value::as_i64).unwrap_or(0),
                item_level_restriction: e.get("item_level_restriction").and_then(Value::as_i64),
                mods,
            })
        })
        .collect();
    essences.sort_by(|a, b| a.name.cmp(&b.name));

    // Bench: explicit crafts for supported classes; currency ids → names.
    let all_bases = obj(get("base_items")?)?;
    let mut bench = Vec::new();
    let mut crafted: BTreeMap<String, ModDef> = BTreeMap::new();
    for o in get("crafting_bench_options")?.as_array().into_iter().flatten() {
        let Some(mod_id) = o.pointer("/actions/add_explicit_mod").and_then(Value::as_str) else { continue };
        let Some(m) = all_mods.get(mod_id) else { continue };
        let gen = m.get("generation_type").and_then(Value::as_str).unwrap_or_default();
        if !(gen == "prefix" || gen == "suffix") {
            continue;
        }
        let item_classes: Vec<String> = strings(o.get("item_classes")).into_iter().filter(|c| supported.contains(c.as_str())).collect();
        if item_classes.is_empty() {
            continue;
        }
        let cost = o
            .get("cost")
            .and_then(Value::as_object)
            .map(|c| {
                c.iter()
                    .filter_map(|(k, v)| {
                        let name = all_bases.get(k).and_then(|b| b.get("name")).and_then(Value::as_str)?;
                        Some((name.to_owned(), v.as_i64()?))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        crafted.entry(mod_id.to_owned()).or_insert_with(|| mod_def(mod_id, m));
        bench.push(BenchDef { mod_id: mod_id.to_owned(), item_classes, cost, tier: o.get("bench_tier").and_then(Value::as_i64).unwrap_or(0) });
    }

    if mods.len() < 1000 || bases.len() < 100 {
        return Err(AppError::InvalidInput("Crafting data from the source looks incomplete.".into()));
    }
    Ok(CraftingData {
        format: FORMAT_VERSION,
        game: GameId::Poe1,
        source: "RePoE (repoe-fork.github.io), extracted from the game files".into(),
        checked_at,
        source_modified,
        classes,
        bases,
        mods,
        fossils,
        essences,
        bench,
        crafted_mods: crafted.into_values().collect(),
        extra_mods,
        search: build_search(all_mods, all_bases),
    })
}

/// Search texts for the Regex module. Domains/tags as RePoE exports them.
fn build_search(all_mods: &Map<String, Value>, all_bases: &Map<String, Value>) -> SearchData {
    let pick = |domain: &str, keep: &dyn Fn(&[String]) -> bool| -> Vec<SearchMod> {
        let mut v: Vec<SearchMod> = all_mods
            .iter()
            .filter(|(_, m)| m.get("domain").and_then(Value::as_str) == Some(domain))
            .filter_map(|(id, m)| {
                let gen = m.get("generation_type").and_then(Value::as_str)?;
                if gen != "prefix" && gen != "suffix" {
                    return None;
                }
                let text = clean_text(m.get("text").and_then(Value::as_str)?);
                if text.trim().is_empty() {
                    return None;
                }
                let tags: Vec<String> = m
                    .get("spawn_weights")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|w| w.get("weight").and_then(Value::as_i64).unwrap_or(0) > 0)
                    .filter_map(|w| w.get("tag").and_then(Value::as_str).map(|t| t.trim().to_owned()))
                    .collect();
                keep(&tags).then(|| SearchMod { id: id.clone(), text, gen: gen.to_owned(), tags })
            })
            .collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    };
    let map_tag = |tags: &[String]| tags.iter().any(|t| t.ends_with("_tier_map"));
    let mut bases: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for b in all_bases.values() {
        if b.get("release_state").and_then(Value::as_str) != Some("released") {
            continue;
        }
        let (Some(class), Some(name)) = (b.get("item_class").and_then(Value::as_str), b.get("name").and_then(Value::as_str)) else { continue };
        let keep = matches!(
            class,
            "Map" | "LifeFlask" | "ManaFlask" | "HybridFlask" | "UtilityFlask" | "Jewel" | "AbyssJewel" | "HeistContract" | "HeistBlueprint" | "ExpeditionLogbook" | "Tincture"
        ) || (class == "MapFragment" && name.ends_with(" Thread"))
            || name.starts_with("Tattoo of ")
            || name.ends_with(" Thread")
            || name.contains("of Threads");
        if keep && !name.is_empty() {
            let key = if name.starts_with("Tattoo of ") { "Tattoo" } else if name.contains("Thread") { "Thread" } else { class };
            bases.entry(key.to_owned()).or_default().push(name.to_owned());
        }
    }
    for v in bases.values_mut() {
        v.sort();
        v.dedup();
    }
    SearchData {
        map_mods: pick("area", &|t| map_tag(t)),
        logbook_mods: pick("area", &|t| t.iter().any(|x| x == "expedition_logbook")),
        flask_mods: pick("flask", &|_| true),
        jewel_mods: {
            let mut v = pick("misc", &|t| !t.is_empty());
            v.extend(pick("abyss_jewel", &|t| !t.is_empty()));
            v
        },
        cluster_mods: pick("affliction_jewel", &|t| !t.is_empty()),
        heist_mods: pick("heist_area", &|t| !t.is_empty()),
        bases,
    }
}

// ---------- service ----------

pub struct CraftingService {
    dir: PathBuf,
    client: reqwest::Client,
    /// One refresh at a time; also guards the cache files.
    lock: tokio::sync::Mutex<()>,
}

impl CraftingService {
    pub fn new(data_dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Vaalytics/", env!("CARGO_PKG_VERSION"), " (Windows desktop companion for Path of Exile)"))
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .build()
            .expect("HTTP client configuration is static and valid");
        Self { dir: data_dir.join("crafting"), client, lock: tokio::sync::Mutex::new(()) }
    }

    fn data_path(&self, game: GameId) -> PathBuf {
        self.dir.join(format!("{}.json", game.as_str()))
    }
    fn meta_path(&self, game: GameId) -> PathBuf {
        self.dir.join(format!("{}.meta.json", game.as_str()))
    }

    fn read_cache(&self, game: GameId) -> Option<CraftingData> {
        let bytes = std::fs::read(self.data_path(game)).ok()?;
        let d: CraftingData = serde_json::from_slice(&bytes).ok()?;
        (d.format == FORMAT_VERSION && d.game == game).then_some(d)
    }

    /// Cached data when fresh; otherwise checks the source (ETag) and rebuilds if it changed.
    pub async fn get(&self, game: GameId, force: bool) -> AppResult<CraftingDataResponse> {
        if game != GameId::Poe1 {
            return Err(AppError::InvalidInput("Crafting is available for Path of Exile 1 only.".into()));
        }
        let _guard = self.lock.lock().await;
        let cached = self.read_cache(game);
        let now = crate::market::http::unix_now();
        if let Some(d) = &cached {
            if !force && now - d.checked_at < MAX_AGE_SECS {
                return Ok(CraftingDataResponse { data: d.clone(), stale_error: None });
            }
        }
        match self.refresh(game, cached.as_ref(), now).await {
            Ok(data) => Ok(CraftingDataResponse { data, stale_error: None }),
            Err(e) => match cached {
                Some(d) => {
                    log::warn!("crafting data refresh failed, using cache: {e}");
                    Ok(CraftingDataResponse { data: d, stale_error: Some(e) })
                }
                None => Err(AppError::InvalidInput(format!("Couldn't download crafting data: {e}"))),
            },
        }
    }

    async fn refresh(&self, game: GameId, cached: Option<&CraftingData>, now: i64) -> Result<CraftingData, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut meta: CacheMeta = std::fs::read(self.meta_path(game)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        if cached.is_none() {
            meta.etags.clear();
        }
        let mut raw = HashMap::new();
        let mut changed = cached.is_none();
        let mut modified = cached.and_then(|c| c.source_modified.clone());
        // Conditional requests first; download everything only if something changed.
        for pass in 0..2 {
            for f in FILES {
                if raw.contains_key(f) {
                    continue;
                }
                let url = format!("{SOURCE_BASE}{f}.min.json");
                let etag = if pass == 0 { meta.etags.get(f).cloned() } else { None };
                let mut req = self.client.get(&url).header(header::ACCEPT, "application/json");
                if let Some(t) = &etag {
                    req = req.header(header::IF_NONE_MATCH, t);
                }
                let resp = req.send().await.map_err(|e| e.without_url().to_string())?;
                if resp.status() == StatusCode::NOT_MODIFIED {
                    continue;
                }
                if !resp.status().is_success() {
                    return Err(format!("{f}: HTTP {}", resp.status().as_u16()));
                }
                if let Some(t) = resp.headers().get(header::ETAG).and_then(|v| v.to_str().ok()) {
                    meta.etags.insert(f.to_owned(), t.to_owned());
                }
                if f == "mods" {
                    modified = resp.headers().get(header::LAST_MODIFIED).and_then(|v| v.to_str().ok()).map(str::to_owned);
                }
                let body = resp.bytes().await.map_err(|e| e.without_url().to_string())?;
                raw.insert(f, serde_json::from_slice::<Value>(&body).map_err(|e| format!("{f}: {e}"))?);
                changed = true;
            }
            if !changed || raw.len() == FILES.len() {
                break;
            }
        }
        let data = if changed {
            build(&raw, now, modified).map_err(|e| e.to_string())?
        } else {
            let mut d = cached.cloned().ok_or("no cache")?;
            d.checked_at = now;
            d
        };
        std::fs::write(self.data_path(game), serde_json::to_vec(&data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::write(self.meta_path(game), serde_json::to_vec(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        log::info!("crafting data {}: {} mods, {} bases", if changed { "rebuilt" } else { "unchanged" }, data.mods.len(), data.bases.len());
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw() -> HashMap<&'static str, Value> {
        let mut mods = Map::new();
        for i in 0..1000 {
            mods.insert(
                format!("Life{i}"),
                json!({"domain":"item","generation_type":"prefix","groups":["IncreasedLife"],"type":"IncreasedLife","required_level":i % 86,
                       "implicit_tags":["life"],"spawn_weights":[{"tag":"default","weight":1000}],"generation_weights":[],"text":"+(3-9) to maximum Life","name":"Hale","is_essence_only":false}),
            );
        }
        mods.insert("Unique1".into(), json!({"domain":"item","generation_type":"unique","spawn_weights":[]}));
        mods.insert("Veiled1".into(), json!({"domain":"unveiled","generation_type":"prefix","text":"+2 to Level of Socketed AoE Gems","spawn_weights":[{"tag":"helmet","weight":1500}]}));
        mods.insert("Zero".into(), json!({"domain":"item","generation_type":"suffix","spawn_weights":[{"tag":"default","weight":0}]}));
        mods.insert("Impl".into(), json!({"domain":"item","generation_type":"unique","text":"+(12-16)% to Fire and Lightning Resistances"}));
        let mut bases = Map::new();
        for i in 0..120 {
            bases.insert(
                format!("Metadata/Items/Rings/Ring{i}"),
                json!({"domain":"item","release_state":"released","item_class":"Ring","name":format!("Ring {i}"),"tags":["ring","default"],"implicits":["Impl"],"drop_level":i}),
            );
        }
        bases.insert("Metadata/Items/Currency/CurrencyRerollMagic".into(), json!({"domain":"undefined","name":"Orb of Alteration"}));
        bases.insert("Hidden".into(), json!({"domain":"item","release_state":"unreleased","item_class":"Ring","name":"Nope"}));
        HashMap::from([
            ("mods", Value::Object(mods)),
            ("base_items", Value::Object(bases)),
            ("item_classes", json!({"Ring":{"name":"Rings","influence_tags":["ring_crusader","ring_elder","ring_basilisk","ring_eyrie","ring_shaper","ring_adjudicator"]}})),
            ("fossils", json!({
                "F1":{"name":"Pristine Fossil","positive_mod_weights":[{"tag":"life","weight":1000}],"negative_mod_weights":[{"tag":"defences","weight":0}],"added_mods":[],"forced_mods":[]},
                "F2":{"name":"Hollow Fossil","positive_mod_weights":[],"negative_mod_weights":[],"forced_mods":["X"]}
            })),
            ("crafting_bench_options", json!([
                {"actions":{"add_explicit_mod":"Life1"},"bench_tier":1,"cost":{"Metadata/Items/Currency/CurrencyRerollMagic":2},"item_classes":["Ring","Jewel"]},
                {"actions":{"change_socket_count":2},"cost":{}}
            ])),
            ("essences", json!({
                "E1":{"name":"Deafening Essence of Greed","level":7,"mods":{"Ring":"Life5"},"type":{"is_corruption_only":false}},
                "E2":{"name":"Essence of Hysteria","level":8,"mods":{"Ring":"X"},"type":{"is_corruption_only":true}}
            })),
        ])
    }

    #[test]
    fn builds_compact_dataset() {
        let d = build(&raw(), 1, None).unwrap();
        assert_eq!(d.mods.len(), 1001, "unique mods dropped, zero-weight kept for recognition");
        assert_eq!(d.bases.len(), 120, "unreleased bases dropped");
        assert_eq!(d.bases[0].implicits, vec!["+(12-16)% to Fire and Lightning Resistances"]);
        assert_eq!(d.fossils.len(), 1, "fossils with special effects are excluded");
        assert_eq!(d.fossils[0].weights, vec![("life".to_string(), 1000), ("defences".to_string(), 0)]);
        assert_eq!(d.essences.len(), 1, "corruption-only essences are excluded");
        assert_eq!(d.classes.iter().find(|c| c.id == "Ring").unwrap().influence_tags.len(), 6);
        assert_eq!(d.bench.len(), 1, "only explicit-mod crafts");
        assert_eq!(d.bench[0].item_classes, vec!["Ring"], "unsupported classes dropped");
        assert_eq!(d.bench[0].cost, vec![("Orb of Alteration".to_string(), 2)]);
        assert_eq!(d.crafted_mods.len(), 1);
        assert_eq!(d.extra_mods.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["Veiled1"], "veiled mods never join the rolling pool");
    }

    #[test]
    fn display_keys_for_textless_stats() {
        assert_eq!(display_key("local_display_socketed_gems_supported_by_level_x_reduced_duration").as_deref(), Some("support:reduced duration"));
        assert_eq!(display_key("socketed_gems_supported_by_x_hypothermia").as_deref(), Some("support:hypothermia"));
        assert_eq!(display_key("local_display_socketed_gems_get_increased_area_level").as_deref(), Some("support:increased area"));
        assert_eq!(display_key("local_display_grants_skill_decoy_totem_level").as_deref(), Some("grant:decoy totem"));
        assert_eq!(display_key("base_maximum_life"), None);
    }

    #[test]
    fn cleans_translation_markup() {
        assert_eq!(clean_text("+(21-26)% to [PlayerItemRarity|Item Rarity]"), "+(21-26)% to Item Rarity");
        assert_eq!(clean_text("Regenerate [Life] per second"), "Regenerate Life per second");
        assert_eq!(clean_text("no markup"), "no markup");
    }

    #[test]
    fn rejects_incomplete_source() {
        let mut r = raw();
        r.insert("mods", json!({}));
        assert!(build(&r, 1, None).is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn live_repoe_builds() {
        let dir = tempfile::tempdir().unwrap();
        let s = CraftingService::new(dir.path().to_path_buf());
        let r = s.get(GameId::Poe1, true).await.unwrap();
        assert!(r.data.mods.len() > 3000, "{}", r.data.mods.len());
        assert!(r.data.fossils.len() >= 15);
        assert!(r.data.essences.len() >= 80);
        assert!(r.data.bench.iter().any(|b| b.mod_id.contains("CannotChangePrefixes")), "metamods present");
        let again = s.get(GameId::Poe1, true).await.unwrap();
        assert_eq!(again.data.mods.len(), r.data.mods.len());
        if let Ok(out) = std::env::var("VAALYTICS_DUMP_CRAFTING") {
            std::fs::write(out, serde_json::to_vec(&r.data).unwrap()).unwrap();
        }
    }
}
