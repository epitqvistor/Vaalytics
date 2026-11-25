//! Icon recognition: compares an inventory cell with reference item art.
//!
//! References are the official item images whose URLs poe.ninja lists for the selected PoE 2 league
//! (web.poecdn.com), downloaded once into a local cache and used only for this comparison — never
//! bundled with Vaalytics. Both sides are reduced to a small RGB grid; the comparison is a normalised
//! correlation over the pixels the reference actually draws (its alpha), skipping the corners where the
//! game prints the stack size (top-left) and tier numerals (bottom-right).
//! Items whose tiers share one picture (II / III numerals) score the same — the result then lists every
//! equally good candidate and the user picks; nothing is guessed.

use super::image::Rgba;

/// Side of the comparison grid.
pub const N: usize = 24;

/// Scales the art is tried at: the game draws 1×1 items slightly differently sized than the CDN images.
pub const SCALES: &[f32] = &[0.84, 0.92, 1.0, 1.08];

#[derive(Debug, Clone)]
struct Variant {
    /// N×N RGB and a weight (alpha 0–1) per pixel.
    rgb: Vec<[f32; 3]>,
    weight: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct Reference {
    pub name: String,
    pub category: String,
    variants: Vec<Variant>,
}

/// The icon drawn at `scale` of the cell, centred (transparent around when smaller, cropped when larger).
fn scaled(icon: &Rgba, scale: f32) -> Rgba {
    // Non-square art is stretched to a square first, as the cell comparison always did.
    let base = icon.w.max(icon.h);
    let sq;
    let icon = if icon.w != icon.h {
        sq = icon.resize(base, base);
        &sq
    } else {
        icon
    };
    let side = (icon.w.max(icon.h) as f32 / scale).round().max(1.0) as usize;
    let mut out = Rgba::new(side, side);
    let ox = (side as i64 - icon.w as i64) / 2;
    let oy = (side as i64 - icon.h as i64) / 2;
    for y in 0..side {
        for x in 0..side {
            let (sx, sy) = (x as i64 - ox, y as i64 - oy);
            if sx >= 0 && sy >= 0 && (sx as usize) < icon.w && (sy as usize) < icon.h {
                out.put(x, y, icon.get(sx as usize, sy as usize));
            }
        }
    }
    out
}

/// Pixels of the N×N grid that are compared (stack size and tier numeral corners excluded).
fn compared(x: usize, y: usize) -> bool {
    let (fx, fy) = (x as f32 / N as f32, y as f32 / N as f32);
    let quantity = fx < 0.5 && fy < 0.3;
    let tier = fx > 0.72 && fy > 0.68;
    !(quantity || tier)
}

impl Reference {
    /// From a decoded icon (RGBA with transparency). None when it has almost no visible pixels.
    pub fn new(name: &str, category: &str, icon: &Rgba) -> Option<Self> {
        let variants: Vec<Variant> = SCALES
            .iter()
            .map(|&s| {
                let small = scaled(icon, s).resize(N, N);
                let mut rgb = Vec::with_capacity(N * N);
                let mut weight = Vec::with_capacity(N * N);
                for y in 0..N {
                    for x in 0..N {
                        let p = small.get(x, y);
                        rgb.push([p[0] as f32, p[1] as f32, p[2] as f32]);
                        weight.push(if compared(x, y) { p[3] as f32 / 255.0 } else { 0.0 });
                    }
                }
                Variant { rgb, weight }
            })
            .filter(|v| v.weight.iter().filter(|w| **w > 0.5).count() > N * N / 10)
            .collect();
        (!variants.is_empty()).then(|| Self { name: name.into(), category: category.into(), variants })
    }
}

/// A cell reduced for comparison.
pub struct CellSample {
    rgb: Vec<[f32; 3]>,
    /// Luma spread inside the cell — near zero for an empty slot.
    pub detail: f32,
    pub mean_luma: f32,
}

pub fn sample(cell: &Rgba) -> CellSample {
    let small = cell.resize(N, N);
    let mut rgb = Vec::with_capacity(N * N);
    let (mut s, mut s2) = (0f32, 0f32);
    for y in 0..N {
        for x in 0..N {
            let p = small.get(x, y);
            let c = [p[0] as f32, p[1] as f32, p[2] as f32];
            let l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
            s += l;
            s2 += l * l;
            rgb.push(c);
        }
    }
    let n = (N * N) as f32;
    let mean = s / n;
    CellSample { rgb, detail: (s2 / n - mean * mean).max(0.0).sqrt(), mean_luma: mean }
}

/// Best weighted colour correlation over the scale variants (−1…1).
pub fn similarity(r: &Reference, c: &CellSample) -> f32 {
    r.variants.iter().map(|v| variant_similarity(v, c)).fold(-1.0, f32::max)
}

fn variant_similarity(r: &Variant, c: &CellSample) -> f32 {
    let mut wsum = 0f32;
    let mut mr = [0f32; 3];
    let mut mc = [0f32; 3];
    for i in 0..N * N {
        let w = r.weight[i];
        if w <= 0.0 {
            continue;
        }
        wsum += w;
        for k in 0..3 {
            mr[k] += w * r.rgb[i][k];
            mc[k] += w * c.rgb[i][k];
        }
    }
    if wsum < 1.0 {
        return -1.0;
    }
    for k in 0..3 {
        mr[k] /= wsum;
        mc[k] /= wsum;
    }
    let (mut num, mut dr, mut dc) = (0f32, 0f32, 0f32);
    for i in 0..N * N {
        let w = r.weight[i];
        if w <= 0.0 {
            continue;
        }
        for k in 0..3 {
            let a = r.rgb[i][k] - mr[k];
            let b = c.rgb[i][k] - mc[k];
            num += w * a * b;
            dr += w * a * a;
            dc += w * b * b;
        }
    }
    if dr <= 1e-3 || dc <= 1e-3 {
        return -1.0;
    }
    // Correlation ignores overall brightness/colour; also require similar mean colour.
    let corr = num / (dr.sqrt() * dc.sqrt());
    let colour = ((mr[0] - mc[0]).powi(2) + (mr[1] - mc[1]).powi(2) + (mr[2] - mc[2]).powi(2)).sqrt() / 441.7;
    corr - 0.6 * colour
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub name: String,
    pub category: String,
    pub score: f32,
}

/// Best references for a cell, best first (at most `limit`).
pub fn rank(refs: &[Reference], c: &CellSample, limit: usize) -> Vec<Candidate> {
    let mut all: Vec<Candidate> = refs.iter().map(|r| Candidate { name: r.name.clone(), category: r.category.clone(), score: similarity(r, c) }).collect();
    all.sort_by(|a, b| b.score.total_cmp(&a.score));
    all.truncate(limit);
    all
}
