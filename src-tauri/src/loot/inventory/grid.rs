//! Locating the PoE 2 inventory grid (12 × 5) in a screenshot of the game window.
//!
//! PoE 2 lays out its UI relative to the window height, the inventory panel anchored to the right edge.
//! Calibrated on a 16:9 screenshot (2560×1440, inventory open): the first grid line sits 0.6013·H from
//! the right edge and 0.5458·H from the top, cells are 0.048756·H wide. The prediction is then refined by
//! searching nearby offsets/scales for the grid's own pattern — a dark gutter and a thin lighter line at
//! every cell boundary — so small layout differences (other aspect ratios, UI scale) still lock on.
//! If the pattern isn't there (inventory closed, other panel open), recognition stops with an error.

use super::image::Rgba;

pub const COLS: usize = 12;
pub const ROWS: usize = 5;
const RIGHT: f32 = 0.6013;
const TOP: f32 = 0.5458;
const CELL: f32 = 0.048756;
/// Mean boundary-line contrast below this means "no inventory grid here".
pub const MIN_SCORE: f32 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Grid {
    pub left: f32,
    pub top: f32,
    pub cell: f32,
    /// Mean contrast of the boundary lines (higher = clearer grid).
    pub score: f32,
}

impl Grid {
    /// Pixel rectangle of a cell's inner area (inset to skip borders).
    pub fn cell_rect(&self, col: usize, row: usize, inset: f32) -> (usize, usize, usize) {
        let x = self.left + col as f32 * self.cell + self.cell * inset;
        let y = self.top + row as f32 * self.cell + self.cell * inset;
        let s = self.cell * (1.0 - 2.0 * inset);
        (x.round().max(0.0) as usize, y.round().max(0.0) as usize, s.round().max(1.0) as usize)
    }

    /// The whole grid, plus a margin (for the stored crop).
    pub fn bounds(&self, margin: f32) -> (usize, usize, usize, usize) {
        let m = self.cell * margin;
        let x = (self.left - m).max(0.0);
        let y = (self.top - m).max(0.0);
        (x as usize, y as usize, (self.cell * COLS as f32 + 2.0 * m) as usize, (self.cell * ROWS as f32 + 2.0 * m) as usize)
    }
}

pub fn predicted(w: usize, h: usize) -> Grid {
    let hf = h as f32;
    Grid { left: w as f32 - RIGHT * hf, top: TOP * hf, cell: CELL * hf, score: 0.0 }
}

/// Contrast of a thin bright line at `pos` against its surroundings, sampled across the grid.
fn score(img: &Rgba, g: &Grid) -> f32 {
    let (w, h) = (img.w as f32, img.h as f32);
    if g.left < 5.0 || g.top < 5.0 || g.left + g.cell * COLS as f32 > w - 4.0 || g.top + g.cell * ROWS as f32 > h - 4.0 {
        return f32::MIN;
    }
    // A boundary is a near-black gutter, a 1 px lighter line, then dark again: line − gutter − the pixel
    // two past the line is positive there, and negative on item edges (bright after) or the game world.
    // Clamped so a few very bright pixels can't outvote the rest.
    let line = |l: f32, g1: f32, g2: f32, after: f32| (l - g1 - g2 - after).clamp(-30.0, 30.0);
    let mut sum = 0.0;
    let mut n = 0.0;
    // Vertical lines, sampled in the middle band of every row (away from crossings).
    for i in 0..=COLS {
        let x = g.left + i as f32 * g.cell;
        let xi = x.round() as usize;
        for r in 0..ROWS {
            for k in 1..6 {
                let y = (g.top + (r as f32 + 0.15 + 0.14 * k as f32) * g.cell) as usize;
                let best = (xi - 1..=xi + 1).map(|xx| line(img.luma(xx, y), img.luma(xx - 2, y), img.luma(xx - 3, y), img.luma(xx + 2, y))).fold(f32::MIN, f32::max);
                sum += best;
                n += 1.0;
            }
        }
    }
    for j in 0..=ROWS {
        let y = g.top + j as f32 * g.cell;
        let yi = y.round() as usize;
        for c in 0..COLS {
            for k in 1..6 {
                let x = (g.left + (c as f32 + 0.15 + 0.14 * k as f32) * g.cell) as usize;
                let best = (yi - 1..=yi + 1).map(|yy| line(img.luma(x, yy), img.luma(x, yy - 2), img.luma(x, yy - 3), img.luma(x, yy + 2))).fold(f32::MIN, f32::max);
                sum += best;
                n += 1.0;
            }
        }
    }
    sum / n
}

/// Finds the grid near the predicted position; Err when no inventory grid is visible.
pub fn locate(img: &Rgba) -> Result<Grid, String> {
    if img.w < 640 || img.h < 360 {
        return Err("The screenshot is too small to find the inventory.".into());
    }
    let best = search(img);
    if best.score < MIN_SCORE {
        return Err("No open inventory was found in the screenshot. Open the inventory (I) in Path of Exile 2 and press the shortcut again.".into());
    }
    Ok(best)
}

/// The best-matching grid position near the prediction (whatever its score).
fn search(img: &Rgba) -> Grid {
    let p = predicted(img.w, img.h);
    let range = (img.h as f32 * 0.02).round() as i32;
    let mut best = Grid { score: f32::MIN, ..p };
    // Coarse: 2 px steps, scales ±3 %.
    for si in -6..=6 {
        let cell = p.cell * (1.0 + si as f32 * 0.005);
        // Keep the right-anchored edge when the scale changes.
        let right = p.left + p.cell * COLS as f32;
        for dy in (-range..=range).step_by(2) {
            for dx in (-range..=range).step_by(2) {
                let g = Grid { left: right - cell * COLS as f32 + dx as f32, top: p.top + dy as f32, cell, score: 0.0 };
                let s = score(img, &g);
                if s > best.score {
                    best = Grid { score: s, ..g };
                }
            }
        }
    }
    // Fine: half-pixel steps around the coarse best.
    let coarse = best;
    for dc in -4..=4 {
        let cell = coarse.cell + dc as f32 * 0.05;
        for dy in -4..=4 {
            for dx in -4..=4 {
                let g = Grid { left: coarse.left + dx as f32 * 0.5, top: coarse.top + dy as f32 * 0.5, cell, score: 0.0 };
                let s = score(img, &g);
                if s > best.score {
                    best = Grid { score: s, ..g };
                }
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::super::image::load_fixture;
    use super::*;

    #[test]
    fn finds_the_grid_in_a_real_screenshot() {
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let g = locate(&img).unwrap();
        // Measured by hand on the fixture: first line x≈1323.5, y≈614, pitch ≈54.85 px.
        assert!((g.left - 1323.5).abs() < 2.0, "{g:?}");
        assert!((g.top - 614.0).abs() < 2.0, "{g:?}");
        assert!((g.cell - 54.85).abs() < 0.6, "{g:?}");
        assert!(g.score > MIN_SCORE + 3.0, "{g:?}");
    }

    #[test]
    #[ignore]
    fn debug_scores() {
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        for (l, t, c) in [(1323.5, 614.0, 54.85), (1328.5, 618.5, 55.0), (1324.0, 614.5, 54.85), (1322.5, 613.0, 54.85)] {
            println!("{l} {t} {c} -> {}", score(&img, &Grid { left: l, top: t, cell: c, score: 0.0 }));
        }
        for y in [640usize, 700, 760] {
            let row: Vec<String> = (1370..1392).map(|x| format!("{}:{:.0}", x, img.luma(x, y))).collect();
            println!("y{y} {}", row.join(" "));
        }
        for x in [1400usize, 1500] {
            let col: Vec<String> = (660..680).map(|y| format!("{}:{:.0}", y, img.luma(x, y))).collect();
            println!("x{x} {}", col.join(" "));
        }
    }

    #[test]
    fn no_grid_without_an_open_inventory() {
        // The left half of the same screenshot (game world, no inventory), scaled to a full frame.
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let world = img.crop(0, 0, 1000, 1125).resize(2000, 1125);
        let best = search(&world);
        assert!(best.score < MIN_SCORE - 2.0, "{best:?}");
        assert!(locate(&world).is_err());
        let flat = Rgba::from_raw(1920, 1080, vec![20; 1920 * 1080 * 4]).unwrap();
        assert!(locate(&flat).unwrap_err().contains("Open the inventory"));
    }
}
