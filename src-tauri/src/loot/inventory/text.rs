//! Text the game prints on inventory cells: the stack size (top-left, white digits — segmented here and
//! matched in digits.rs) and tier numerals (bottom-right, "II" / "III", by counting strokes).
//! Windows' built-in OCR was tried first (2026-11-25) and skipped most one- and two-digit stacks.
//! Runs once per screenshot, on the recognition thread; nothing is read continuously.

use super::image::Rgba;

/// Text-like pixel: bright and nearly colourless (the game's white digits; item art is coloured).
fn is_text(p: [u8; 4]) -> bool {
    let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    max >= 170 && max - min <= 55
}

/// Glyph bitmap size used for digit matching.
pub const GW: usize = 8;
pub const GH: usize = 12;

/// Normalised glyphs (left to right) of the stack-size digits in a cell's top-left region:
/// GW×GH coverage values 0–1, plus the glyph's width/height ratio as the last value.
///
/// Digits are the connected white components that share one height and top line, start near the
/// cell's left edge and follow each other closely; bright specks of item art fail those tests.
/// Touching digits (one component much wider than a digit) are split evenly.
#[cfg(test)]
pub fn glyphs(region: &Rgba) -> Vec<Vec<f32>> {
    glyphs_checked(region).0
}

/// Like `glyphs`, plus whether something digit-sized sits right after the last digit without
/// joining the line — e.g. a digit fused with bright item art. Such readings must be confirmed.
pub fn glyphs_checked(region: &Rgba) -> (Vec<Vec<f32>>, bool) {
    let (w, h) = (region.w, region.h);
    let text: Vec<bool> = (0..w * h).map(|i| is_text(region.get(i % w, i / w))).collect();
    // Connected components (8-neighbourhood): bounding boxes and sizes.
    let mut label = vec![usize::MAX; w * h];
    let mut comps: Vec<(usize, usize, usize, usize, usize)> = Vec::new(); // x0, y0, x1, y1 (exclusive), pixels
    for start in 0..w * h {
        if !text[start] || label[start] != usize::MAX {
            continue;
        }
        let id = comps.len();
        let mut stack = vec![start];
        label[start] = id;
        let (mut x0, mut y0, mut x1, mut y1, mut n) = (w, h, 0, 0, 0);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
            n += 1;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if text[j] && label[j] == usize::MAX {
                        label[j] = id;
                        stack.push(j);
                    }
                }
            }
        }
        comps.push((x0, y0, x1, y1, n));
    }
    // Digit-sized components: 40–98 % of the region's height.
    let tall: Vec<_> = comps.iter().copied().filter(|c| (c.3 - c.1) as f32 >= h as f32 * 0.4 && (c.3 - c.1) as f32 <= h as f32 * 0.98).collect();
    let Some(first) = tall.iter().copied().filter(|c| (c.0 as f32) < w as f32 * 0.3).min_by_key(|c| c.0) else { return (Vec::new(), false) };
    let th = (first.3 - first.1) as f32;
    let mut chain = vec![first];
    let mut sorted: Vec<_> = tall.into_iter().filter(|c| c.0 > first.0).collect();
    sorted.sort_by_key(|c| c.0);
    for c in sorted {
        let last = *chain.last().unwrap();
        let gap = c.0 as f32 - last.2 as f32;
        let same_line = ((c.1 as f32 - first.1 as f32).abs() <= th * 0.2) && (((c.3 - c.1) as f32 - th).abs() <= th * 0.25);
        if gap <= th * 0.45 && same_line {
            chain.push(c);
        } else if gap > th * 0.45 {
            break;
        }
    }
    let end = chain.last().map(|c| c.2).unwrap_or(0) as f32;
    // Ink after the line: any component at least a third of a digit tall starting close behind it.
    let suspicious = comps.iter().any(|c| {
        let ch = (c.3 - c.1) as f32;
        let starts = c.0 as f32;
        starts >= end && starts - end <= th * 0.7 && ch >= th * 0.33 && (c.1 as f32) < first.1 as f32 + th * 0.8
    });
    let mut out = Vec::new();
    for (cx0, _, cx1, _, _) in chain {
        let (y0, y1) = (first.1, first.1 + th as usize);
        let gw = cx1 - cx0;
        let parts = if gw as f32 > th * 1.0 { ((gw as f32 / (th * 0.6)).round() as usize).max(2) } else { 1 };
        for k in 0..parts {
            let pa = cx0 + gw * k / parts;
            let pb = cx0 + gw * (k + 1) / parts;
            out.push(normalise(&text, w, h, pa, pb, y0, y1));
        }
    }
    (out, suspicious)
}

fn normalise(text: &[bool], w: usize, h: usize, pa: usize, pb: usize, y0: usize, y1: usize) -> Vec<f32> {
    let th = (y1 - y0) as f32;
    let mut g = vec![0f32; GW * GH];
    for gy in 0..GH {
        for gx in 0..GW {
            let sx0 = pa as f32 + (pb - pa) as f32 * gx as f32 / GW as f32;
            let sx1 = pa as f32 + (pb - pa) as f32 * (gx + 1) as f32 / GW as f32;
            let sy0 = y0 as f32 + th * gy as f32 / GH as f32;
            let sy1 = y0 as f32 + th * (gy + 1) as f32 / GH as f32;
            let (mut on, mut n) = (0f32, 0f32);
            let mut yy = sy0.floor() as usize;
            while (yy as f32) < sy1.max(sy0 + 0.5) && yy < h {
                let mut xx = sx0.floor() as usize;
                while (xx as f32) < sx1.max(sx0 + 0.5) && xx < w {
                    on += text[yy * w + xx] as u8 as f32;
                    n += 1.0;
                    xx += 1;
                }
                yy += 1;
            }
            g[gy * GW + gx] = if n > 0.0 { on / n } else { 0.0 };
        }
    }
    g.push((pb - pa) as f32 / th);
    g
}

/// Tier numeral in a cell's bottom-right corner: the number of separate vertical white strokes (0 = none).
pub fn tier_strokes(cell: &Rgba) -> u8 {
    let x0 = (cell.w as f32 * 0.66) as usize;
    let y0 = (cell.h as f32 * 0.62) as usize;
    let zone = cell.crop(x0, y0, cell.w - x0, cell.h - y0);
    // Column has a stroke when enough of its height is text-like.
    let min_run = (zone.h as f32 * 0.35).max(3.0) as usize;
    let cols: Vec<bool> = (0..zone.w)
        .map(|x| {
            let mut best = 0;
            let mut run = 0;
            for y in 0..zone.h {
                if is_text(zone.get(x, y)) {
                    run += 1;
                    best = best.max(run);
                } else {
                    run = 0;
                }
            }
            best >= min_run
        })
        .collect();
    let mut strokes = 0u8;
    let mut prev = false;
    for c in cols {
        if c && !prev {
            strokes = strokes.saturating_add(1);
        }
        prev = c;
    }
    strokes
}
