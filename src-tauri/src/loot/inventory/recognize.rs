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
    /// The cell holds something that isn't a stackable (equipment, its own coloured background):
    /// stored excluded, not counted and not asked about.
    pub not_stackable: bool,
}

/// Stackable currency sits on the inventory's navy slot background; equipment and other items get a
/// coloured background (e.g. dark red) over all the cells they cover. Decided from the cell corners.
fn stackable_background(cell: &Rgba) -> bool {
    let s = cell.w;
    let k = (s as f32 * 0.07).max(2.0) as usize;
    let corners = [(1usize, 1usize), (s - k - 1, 1), (1, s - k - 1), (s - k - 1, s - k - 1)];
    let navy = corners
        .iter()
        .filter(|(x, y)| {
            let (mut r, mut g, mut b, mut n) = (0f32, 0f32, 0f32, 0f32);
            for yy in *y..(*y + k).min(cell.h) {
                for xx in *x..(*x + k).min(cell.w) {
                    let p = cell.get(xx, yy);
                    r += p[0] as f32;
                    g += p[1] as f32;
                    b += p[2] as f32;
                    n += 1.0;
                }
            }
            let (r, g, b) = (r / n, g / n, b / n);
            b > r + 8.0 && b > g + 8.0
        })
        .count();
    navy >= 2
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
    if !stackable_background(cell_img) {
        return Some(CellResult {
            col,
            row,
            name: None,
            category: Some("other".into()),
            icon_score: 0.0,
            alternatives: Vec::new(),
            tier_strokes: 0,
            quantity: None,
            quantity_confidence: 0.0,
            icon_confidence: Confidence::Unknown,
            confidence: Confidence::Unknown,
            not_stackable: true,
        });
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
            not_stackable: false,
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
        not_stackable: false,
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

    /// The real in-game capture (2560×1440, inventory crop as stored by Vaalytics).
    fn real() -> (Rgba, Grid) {
        (super::super::image::load_fixture("poe2-2560x1440-capture-crop.png"), Grid { left: 11.128, top: 10.952, cell: 70.209, score: 24.0 })
    }

    #[test]
    fn real_capture_stack_sizes_and_equipment_cells() {
        let (img, g) = real();
        let cell = |c: usize, r: usize| {
            let (x, y, s) = g.cell_rect(c, r, 0.0);
            img.crop(x, y, s, s)
        };
        let qty = |c: usize, r: usize| {
            let k = cell(c, r);
            let s = k.w;
            digits::read(&k.crop(0, 0, (s as f32 * 0.62) as usize, (s as f32 * 0.36) as usize)).map(|q| q.value)
        };
        assert_eq!(qty(0, 3), Some(54), "the 5 is known");
        assert_eq!(qty(2, 2), Some(10));
        assert_eq!(qty(0, 0), Some(1));
        // Currency on the navy slot background; the helmet / ring cells (dark red background) aren't stackables.
        for (c, r) in [(0, 0), (0, 1), (0, 2), (0, 3), (0, 4), (2, 2)] {
            assert!(stackable_background(&cell(c, r)), "c{c} r{r}");
        }
        for (c, r) in [(1, 0), (2, 0), (1, 1), (2, 1), (1, 3), (2, 3), (1, 4), (2, 4)] {
            assert!(!stackable_background(&cell(c, r)), "c{c} r{r}");
        }
        // Without references: equipment cells come back as excluded "other", empty slots not at all.
        let refs: Vec<Reference> = Vec::new();
        let equip = super::cell(&refs, &cell(1, 3), 1, 3).unwrap();
        assert!(equip.not_stackable && equip.name.is_none());
        assert!(super::cell(&refs, &cell(8, 2), 8, 2).is_none(), "empty slot");
    }

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
