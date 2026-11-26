//! Change detection: compares a normalized remote entry list with the installed one.
//! Pure functions; the store persists the result.

use super::model::{hash_value, ChangeType, Entry};
use super::registry::DatasetDef;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub key: String,
    pub name: String,
    pub change_type: ChangeType,
    /// Changed fields (data keys) for modifications.
    pub fields: Vec<String>,
    pub before: Option<Value>,
    pub after: Option<Value>,
}

impl Change {
    pub fn after_hash(&self) -> Option<String> {
        self.after.as_ref().map(hash_value)
    }
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct DiffSummary {
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
    pub deprecated: usize,
    pub structural: bool,
    pub duplicates: Vec<String>,
}

/// Keys of fields present in any entry.
fn field_set(entries: &[Entry]) -> BTreeSet<String> {
    entries.iter().filter_map(|e| e.data.as_object()).flat_map(|o| o.keys().cloned()).collect()
}

fn entry_value(e: &Entry) -> Value {
    serde_json::json!({ "name": e.name, "data": e.data })
}

/// Detects added / modified / removed / deprecated entries and structural (schema) changes.
/// `installed` may be empty (first install): then every entry is `added`.
pub fn diff(def: &DatasetDef, installed: &[Entry], remote: &[Entry]) -> (Vec<Change>, DiffSummary) {
    let mut summary = DiffSummary::default();
    let mut seen = BTreeSet::new();
    for e in remote {
        if !seen.insert(e.key.as_str()) {
            summary.duplicates.push(e.key.clone());
        }
    }
    let old: BTreeMap<&str, &Entry> = installed.iter().map(|e| (e.key.as_str(), e)).collect();
    let new: BTreeMap<&str, &Entry> = remote.iter().map(|e| (e.key.as_str(), e)).collect();
    let mut changes = Vec::new();

    if !installed.is_empty() {
        let (fo, fnew) = (field_set(installed), field_set(remote));
        if fo != fnew {
            summary.structural = true;
            let gone: Vec<&String> = fo.difference(&fnew).collect();
            let added: Vec<&String> = fnew.difference(&fo).collect();
            changes.push(Change {
                key: "__schema".into(),
                name: "Data structure".into(),
                change_type: ChangeType::Structural,
                fields: gone.iter().chain(added.iter()).map(|s| s.to_string()).collect(),
                before: Some(serde_json::json!(fo)),
                after: Some(serde_json::json!(fnew)),
            });
        }
    }

    for (k, e) in &new {
        match old.get(k) {
            None => {
                summary.added += 1;
                changes.push(Change { key: k.to_string(), name: e.name.clone(), change_type: ChangeType::Added, fields: vec![], before: None, after: Some(entry_value(e)) });
            }
            Some(o) if o.data != e.data || o.name != e.name => {
                let mut fields: Vec<String> = Vec::new();
                if o.name != e.name {
                    fields.push("name".into());
                }
                let (od, nd) = (o.data.as_object(), e.data.as_object());
                let keys: BTreeSet<&String> = od.into_iter().flat_map(|m| m.keys()).chain(nd.into_iter().flat_map(|m| m.keys())).collect();
                for f in keys {
                    if od.and_then(|m| m.get(f)) != nd.and_then(|m| m.get(f)) {
                        fields.push(f.clone());
                    }
                }
                let became_deprecated = def.deprecated_flag.is_some_and(|flag| {
                    fields.iter().any(|f| f == flag) && e.data.get(flag).and_then(Value::as_bool) == Some(true)
                });
                let change_type = if became_deprecated {
                    summary.deprecated += 1;
                    ChangeType::Deprecated
                } else {
                    summary.modified += 1;
                    classify(def, &fields)
                };
                changes.push(Change { key: k.to_string(), name: e.name.clone(), change_type, fields, before: Some(entry_value(o)), after: Some(entry_value(e)) });
            }
            Some(_) => {}
        }
    }
    for (k, o) in &old {
        if !new.contains_key(k) {
            let change_type = if def.removal_is_deprecation {
                summary.deprecated += 1;
                ChangeType::Deprecated
            } else {
                summary.removed += 1;
                ChangeType::Removed
            };
            changes.push(Change { key: k.to_string(), name: o.name.clone(), change_type, fields: vec![], before: Some(entry_value(o)), after: None });
        }
    }
    (changes, summary)
}

/// One type for a modification: the field rule when all changed fields agree, otherwise `modified`.
fn classify(def: &DatasetDef, fields: &[String]) -> ChangeType {
    let types: BTreeSet<&str> = fields
        .iter()
        .map(|f| def.field_rules.iter().find(|(name, _)| name == f).map(|(_, t)| *t).unwrap_or(ChangeType::MetadataUpdated).as_str())
        .collect();
    match (types.len(), fields.first()) {
        (1, Some(f)) => def.field_rules.iter().find(|(name, _)| name == f).map(|(_, t)| *t).unwrap_or(ChangeType::MetadataUpdated),
        (0, _) => ChangeType::Unknown,
        _ => ChangeType::Modified,
    }
}

/// Applies a subset of changes to the installed entries (partial application).
/// Structural changes can't be applied partially; the caller checks that.
pub fn apply_changes(installed: &[Entry], changes: &[Change]) -> Vec<Entry> {
    let mut map: BTreeMap<String, Entry> = installed.iter().map(|e| (e.key.clone(), e.clone())).collect();
    for c in changes {
        if c.change_type == ChangeType::Structural {
            continue;
        }
        match &c.after {
            Some(v) => {
                let name = v.get("name").and_then(Value::as_str).unwrap_or(&c.name).to_string();
                let data = v.get("data").cloned().unwrap_or(Value::Null);
                map.insert(c.key.clone(), Entry { key: c.key.clone(), name, data });
            }
            None => {
                map.remove(&c.key);
            }
        }
    }
    map.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updates::registry::dataset;
    use serde_json::json;

    fn card(name: &str, reward: &str, legacy: bool) -> Entry {
        Entry { key: name.into(), name: name.into(), data: json!({"reward": reward, "rewardKind": "currencyitem", "legacy": legacy, "stackSize": 5, "dropLevel": 1}) }
    }

    #[test]
    fn detects_added_modified_removed_deprecated_and_unchanged() {
        let def = dataset("poe1.divination-cards").unwrap();
        let old = vec![card("A", "1x Chaos", false), card("B", "Headhunter", false), card("C", "x", false), card("D", "same", false)];
        let new = vec![card("A", "2x Chaos", false), card("B", "Headhunter", true), card("D", "same", false), card("E", "new", false)];
        let (changes, s) = diff(def, &old, &new);
        let ty = |k: &str| changes.iter().find(|c| c.key == k).map(|c| c.change_type);
        assert_eq!(ty("A"), Some(ChangeType::DescriptionUpdated));
        assert_eq!(ty("B"), Some(ChangeType::Deprecated));
        assert_eq!(ty("C"), Some(ChangeType::Removed));
        assert_eq!(ty("D"), None, "unchanged entries produce no change");
        assert_eq!(ty("E"), Some(ChangeType::Added));
        assert_eq!((s.added, s.modified, s.removed, s.deprecated, s.structural), (1, 1, 1, 1, false));
        assert_eq!(changes.iter().find(|c| c.key == "A").unwrap().fields, vec!["reward".to_string()]);
    }

    #[test]
    fn mixed_field_changes_are_modified_and_unknown_fields_metadata() {
        let def = dataset("poe1.divination-cards").unwrap();
        let mut b = card("A", "2x", false);
        b.data["stackSize"] = json!(9);
        let (c, _) = diff(def, &[card("A", "1x", false)], &[b]);
        assert_eq!(c[0].change_type, ChangeType::Modified);
        let mut d = card("A", "1x", false);
        d.data["dropLevel"] = json!(70);
        let (c, _) = diff(def, &[card("A", "1x", false)], &[d]);
        assert_eq!(c[0].change_type, ChangeType::MetadataUpdated);
    }

    #[test]
    fn detects_structural_changes_and_duplicates() {
        let def = dataset("poe1.divination-cards").unwrap();
        let mut x = card("A", "1x", false);
        x.data.as_object_mut().unwrap().remove("dropLevel");
        x.data["artwork"] = json!("a.png");
        let (c, s) = diff(def, &[card("A", "1x", false)], &[x.clone(), x]);
        assert!(s.structural);
        assert_eq!(c[0].change_type, ChangeType::Structural);
        assert_eq!(s.duplicates, vec!["A".to_string()]);
    }

    #[test]
    fn first_install_is_all_added_and_league_removal_is_deprecation() {
        let def = dataset("poe1.divination-cards").unwrap();
        let (c, s) = diff(def, &[], &[card("A", "1", false)]);
        assert_eq!((c.len(), s.added, s.structural), (1, 1, false));
        let leagues = dataset("poe1.leagues").unwrap();
        let l = |n: &str| Entry { key: n.into(), name: n.into(), data: json!({"hardcore": false, "indexed": true}) };
        let (c, s) = diff(leagues, &[l("Old"), l("Standard")], &[l("Standard"), l("New")]);
        assert_eq!((s.added, s.deprecated, s.removed), (1, 1, 0));
        assert!(c.iter().any(|c| c.key == "Old" && c.change_type == ChangeType::Deprecated));
    }

    #[test]
    fn partial_application_only_touches_selected_entries() {
        let def = dataset("poe1.divination-cards").unwrap();
        let old = vec![card("A", "1", false), card("B", "1", false)];
        let new = vec![card("A", "2", false), card("C", "3", false)];
        let (changes, _) = diff(def, &old, &new);
        let only_add: Vec<Change> = changes.iter().filter(|c| c.change_type == ChangeType::Added).cloned().collect();
        let merged = apply_changes(&old, &only_add);
        let keys: Vec<&str> = merged.iter().map(|e| e.key.as_str()).collect();
        assert_eq!(keys, vec!["A", "B", "C"]);
        assert_eq!(merged[0].data["reward"], "1", "unselected modification is not applied");
        let all = apply_changes(&old, &changes);
        assert_eq!(crate::updates::model::hash_entries(&all), crate::updates::model::hash_entries(&new));
    }
}
