//! Structural, semantic and source validation of a normalized dataset before it can be staged
//! or applied. A `Failed` result blocks application; `Review` needs the user.

use super::diff::DiffSummary;
use super::model::{Entry, Reliability, Validation};
use super::registry::DatasetDef;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub level: Validation,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub result: Validation,
    pub notes: Vec<Note>,
}

fn note(notes: &mut Vec<Note>, level: Validation, message: impl Into<String>) {
    notes.push(Note { level, message: message.into() });
}

/// `installed_count` is the size of the installed version (0 on first install).
pub fn validate(def: &DatasetDef, entries: &[Entry], installed_count: usize, diff: Option<&DiffSummary>, reliability: Reliability) -> Outcome {
    let mut notes = Vec::new();

    // ---- structural ----
    if entries.len() < def.min_entries {
        note(&mut notes, Validation::Failed, format!("Only {} entries; at least {} expected — the source looks incomplete.", entries.len(), def.min_entries));
    }
    let mut keys = HashSet::new();
    let mut dup = 0;
    for e in entries {
        if e.key.trim().is_empty() || e.key.len() > 200 || e.key.chars().any(char::is_control) {
            note(&mut notes, Validation::Failed, format!("Invalid identifier {:?}.", e.key.chars().take(40).collect::<String>()));
            break;
        }
        if !keys.insert(e.key.as_str()) {
            dup += 1;
        }
        if e.name.trim().is_empty() {
            note(&mut notes, Validation::Failed, format!("Entry {} has no name.", e.key));
            break;
        }
        let Some(obj) = e.data.as_object() else {
            note(&mut notes, Validation::Failed, format!("Entry {} has no data object.", e.key));
            break;
        };
        if let Some(f) = def.required_fields.iter().find(|f| !obj.contains_key(**f)) {
            note(&mut notes, Validation::Failed, format!("Entry {} is missing the required field {f}.", e.key));
            break;
        }
        // ---- semantic: reasonable numbers ----
        if let Some((f, n)) = obj.iter().find_map(|(k, v)| v.as_f64().filter(|n| !n.is_finite() || *n < 0.0 || *n > 1e9).map(|n| (k, n))) {
            note(&mut notes, Validation::Review, format!("Entry {} has a suspicious value {f} = {n}.", e.key));
        }
        if obj.values().any(|v| matches!(v, Value::String(s) if s.len() > 4000)) {
            note(&mut notes, Validation::Review, format!("Entry {} has an unusually long text field.", e.key));
        }
    }
    if dup > 0 {
        note(&mut notes, Validation::Failed, format!("{dup} duplicated identifiers."));
    }

    // ---- change size / structure ----
    if let Some(d) = diff {
        if d.structural {
            note(&mut notes, Validation::Review, "The data structure changed (fields added or removed). Review before applying.");
        }
        if installed_count > 0 {
            let removed = d.removed as f64 / installed_count as f64;
            if removed > 0.2 {
                note(&mut notes, Validation::Review, format!("{} of {} entries would be removed ({:.0} %).", d.removed, installed_count, removed * 100.0));
            } else if d.removed > 0 {
                note(&mut notes, Validation::Warnings, format!("{} entries removed by the source.", d.removed));
            }
        }
    }

    // ---- source ----
    match reliability {
        Reliability::Official | Reliability::Structured => {}
        Reliability::Community => note(&mut notes, Validation::Warnings, "Community source: data is not verified by GGG."),
        Reliability::Unverified => note(&mut notes, Validation::Review, "Unverified source: review before applying."),
    }

    let result = notes.iter().map(|n| n.level).max().unwrap_or(Validation::Passed);
    Outcome { result, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updates::registry::dataset;
    use serde_json::json;

    fn cards(n: usize) -> Vec<Entry> {
        (0..n).map(|i| Entry { key: format!("C{i}"), name: format!("Card {i}"), data: json!({"reward": "x", "rewardKind": "", "legacy": false, "stackSize": 3}) }).collect()
    }

    #[test]
    fn valid_dataset_passes() {
        let def = dataset("poe1.divination-cards").unwrap();
        let o = validate(def, &cards(400), 0, None, Reliability::Structured);
        assert_eq!(o.result, Validation::Passed, "{:?}", o.notes);
    }

    #[test]
    fn incomplete_missing_fields_and_duplicates_fail() {
        let def = dataset("poe1.divination-cards").unwrap();
        assert_eq!(validate(def, &cards(10), 0, None, Reliability::Structured).result, Validation::Failed);
        let mut c = cards(400);
        c[5].data.as_object_mut().unwrap().remove("reward");
        assert_eq!(validate(def, &c, 0, None, Reliability::Structured).result, Validation::Failed);
        let mut c = cards(400);
        c[1].key = "C0".into();
        assert_eq!(validate(def, &c, 0, None, Reliability::Structured).result, Validation::Failed);
        let mut c = cards(400);
        c[2].key = " ".into();
        assert_eq!(validate(def, &c, 0, None, Reliability::Structured).result, Validation::Failed);
    }

    #[test]
    fn suspicious_values_untrusted_sources_and_mass_removal_need_review() {
        let def = dataset("poe1.divination-cards").unwrap();
        let mut c = cards(400);
        c[0].data["stackSize"] = json!(-4);
        assert_eq!(validate(def, &c, 0, None, Reliability::Structured).result, Validation::Review);
        assert_eq!(validate(def, &cards(400), 0, None, Reliability::Unverified).result, Validation::Review);
        assert_eq!(validate(def, &cards(400), 0, None, Reliability::Community).result, Validation::Warnings);
        let d = DiffSummary { removed: 150, ..Default::default() };
        assert_eq!(validate(def, &cards(400), 550, Some(&d), Reliability::Structured).result, Validation::Review);
        let d = DiffSummary { removed: 2, ..Default::default() };
        assert_eq!(validate(def, &cards(400), 402, Some(&d), Reliability::Structured).result, Validation::Warnings);
        let d = DiffSummary { structural: true, ..Default::default() };
        assert_eq!(validate(def, &cards(400), 400, Some(&d), Reliability::Structured).result, Validation::Review);
    }
}
