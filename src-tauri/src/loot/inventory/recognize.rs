//! One inventory screenshot → per-cell results: item (from icon + tier numeral), stack size, confidence.
//! Pure: no I/O, so it is tested on real screenshots in tests/fixtures/inventory.

use super::digits;
#[cfg(test)]
use super::grid::{self, Grid};
use super::icons::{self, Reference};
use super::image::Rgba;
use super::text;
use serde::{Deserialize, Serialize};

/// Bumped when recognition output changes (stored with every snapshot).
pub const RECOGNIZER_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Unknown,
    Low,
    Medium,
    High,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::Unknown => "unknown",
            Confidence::Low => "low",
            Confidence::Medium => "medium",
            Confidence::High => "high",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellResult {
    pub col: usize,
    pub row: usize,
    /// Best item name; None when the cell isn't recognised.
    pub name: Option<String>,
    pub category: Option<String>,
    pub icon_score: f32,
    /// Other plausible items (for the user to pick from), best first.
    pub alternatives: Vec<String>,
    /// Vertical strokes of a tier numeral (0 none, 2 = II, 3 = III).
    pub tier_strokes: u8,
    pub quantity: Option<u32>,
    pub quantity_confidence: f32,
    pub icon_confidence: Confidence,
    pub confidence: Confidence,
}

/// Empty slots are flat and dark.
fn is_empty(s: &icons::CellSample) -> bool {
    s.detail < 10.0 && s.mean_luma < 45.0
}

/// Tier prefix a numeral stands for (PoE 2 names "Greater …" / "Perfect …" share the base art).
fn tier_name_fits(name: &str, strokes: u8) -> bool {
    match strokes {
        2 => name.starts_with("Greater "),
        3 => name.starts_with("Perfect "),
        _ => !name.starts_with("Greater ") && !name.starts_with("Perfect "),
    }
}

fn icon_confidence(score: f32, margin: f32) -> Confidence {
    if score >= 0.72 && margin >= 0.15 {
        Confidence::High
    } else if score >= 0.6 && margin >= 0.08 {
        Confidence::Medium
    } else if score >= 0.45 {
        Confidence::Low
    } else {
        Confidence::Unknown
    }
}

fn quantity_confidence(q: Option<digits::Reading>) -> Confidence {
    match q {
        Some(r) if r.confidence >= 0.45 => Confidence::High,
        Some(r) if r.confidence >= 0.25 => Confidence::Medium,
        Some(_) => Confidence::Low,
        None => Confidence::Unknown,
    }
}

/// Recognises one cell (already cropped to its full square).
pub fn cell(refs: &[Reference], cell_img: &Rgba, col: usize, row: usize) -> Option<CellResult> {
    let s = cell_img.w;
    let inner = cell_img.crop((s as f32 * 0.04) as usize, (s as f32 * 0.04) as usize, (s as f32 * 0.92) as usize, (s as f32 * 0.92) as usize);
    let sample = icons::sample(&inner);
    if is_empty(&sample) {
        return None;
    }
    let strokes = text::tier_strokes(cell_img);
    let qty_region = cell_img.crop(0, 0, (s as f32 * 0.62) as usize, (s as f32 * 0.36) as usize);
    let qty = digits::read(&qty_region);
    let ranked = icons::rank(refs, &sample, 12);
    let Some(top) = ranked.first().cloned() else {
        return Some(CellResult {
            col,
            row,
            name: None,
            category: None,
            icon_score: 0.0,
            alternatives: Vec::new(),
            tier_strokes: strokes,
            quantity: qty.map(|q| q.value),
            quantity_confidence: qty.map(|q| q.confidence).unwrap_or(0.0),
            icon_confidence: Confidence::Unknown,
            confidence: Confidence::Unknown,
        });
    };
    // Same art (tier variants) scores the same; pick the variant the numeral names.
    let same: Vec<&icons::Candidate> = ranked.iter().filter(|c| (top.score - c.score).abs() < 0.004).collect();
    let others_best = ranked.iter().find(|c| (top.score - c.score).abs() >= 0.004).map(|c| c.score).unwrap_or(-1.0);
    let margin = top.score - others_best;
    let chosen = same.iter().find(|c| tier_name_fits(&c.name, strokes)).copied();
    let mut ic = icon_confidence(top.score, margin);
    if same.len() > 1 && chosen.is_none() {
        ic = ic.min(Confidence::Low); // tier variants we can't tell apart
    }
    let pick = chosen.unwrap_or(same[0]);
    let alternatives: Vec<String> = ranked.iter().filter(|c| c.name != pick.name && c.score >= top.score - 0.2).take(6).map(|c| c.name.clone()).collect();
    let qc = quantity_confidence(qty);
    let (name, category) = if ic == Confidence::Unknown { (None, None) } else { (Some(pick.name.clone()), Some(pick.category.clone())) };
    Some(CellResult {
        col,
        row,
        name,
        category,
        icon_score: top.score,
        alternatives,
        tier_strokes: strokes,
        quantity: qty.map(|q| q.value),
        quantity_confidence: qty.map(|q| q.confidence).unwrap_or(0.0),
        icon_confidence: ic,
        confidence: ic.min(qc),
    })
}

/// The whole inventory: grid location plus a result per occupied cell (tests; the service records progress itself).
#[cfg(test)]
pub fn inventory(refs: &[Reference], screenshot: &Rgba) -> Result<(Grid, Vec<CellResult>), String> {
    let g = grid::locate(screenshot)?;
    let mut out = Vec::new();
    for row in 0..grid::ROWS {
        for col in 0..grid::COLS {
            let (x, y, s) = g.cell_rect(col, row, 0.0);
            let c = screenshot.crop(x, y, s, s);
            if let Some(r) = cell(refs, &c, col, row) {
                out.push(r);
            }
        }
    }
    Ok((g, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_numerals_pick_the_variant() {
        assert!(tier_name_fits("Exalted Orb", 0));
        assert!(!tier_name_fits("Greater Exalted Orb", 0));
        assert!(tier_name_fits("Greater Exalted Orb", 2));
        assert!(tier_name_fits("Perfect Exalted Orb", 3));
        assert!(!tier_name_fits("Exalted Orb", 3));
        assert_eq!(icon_confidence(0.8, 0.3), Confidence::High);
        assert_eq!(icon_confidence(0.8, 0.05), Confidence::Low);
        assert_eq!(icon_confidence(0.3, 0.3), Confidence::Unknown);
        assert_eq!(Confidence::High.min(Confidence::Low), Confidence::Low);
    }
}
