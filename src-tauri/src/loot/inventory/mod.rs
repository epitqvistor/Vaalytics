//! Inventory screenshot recognition (PoE 2). One screenshot per deliberate hotkey press; no continuous
//! capture or OCR. Spec: docs/modules/loot-journal.md ("Inventory snapshots").

pub mod capture;
pub mod digits;
pub mod grid;
pub mod icons;
pub mod image;
pub mod recognize;
pub mod refs;
pub mod service;
pub mod snapshots;
pub mod text;

#[cfg(test)]
mod explore {
    use super::recognize::Confidence;
    use super::{grid, icons, text};

    /// Loads reference icons from `LOOT_ICON_DIR` (list2.tsv: hash, category, name, url + <hash>.png).
    pub fn load_refs() -> Vec<icons::Reference> {
        let dir = std::path::PathBuf::from(std::env::var("LOOT_ICON_DIR").expect("LOOT_ICON_DIR"));
        let list = std::fs::read_to_string(dir.join("list2.tsv")).unwrap();
        list.lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\t').collect();
                let bytes = std::fs::read(dir.join(format!("{}.png", f[0]))).ok()?;
                let img = super::image::Rgba::from_png(&bytes).ok()?;
                icons::Reference::new(f[2], f[1], &img)
            })
            .collect()
    }

    #[test]
    #[ignore]
    fn match_fixture_cells() {
        let refs = load_refs();
        println!("{} references", refs.len());
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let g = grid::locate(&img).unwrap();
        for r in 0..grid::ROWS {
            for c in 0..grid::COLS {
                let (x, y, s) = g.cell_rect(c, r, 0.04);
                let cell = img.crop(x, y, s, s);
                let smp = icons::sample(&cell);
                let top = icons::rank(&refs, &smp, 3);
                let t: Vec<String> = top.iter().map(|k| format!("{} {:.2}", k.name, k.score)).collect();
                println!("r{r} c{c:02} detail {:.0} | {}", smp.detail, t.join(" | "));
            }
        }
    }
    use super::image::load_fixture;

    /// Prints brightness profiles around the inventory grid (calibration aid).
    #[test]
    #[ignore]
    fn profile_grid() {
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        println!("size {}x{}", img.w, img.h);
        // Column profile across the grid band.
        let (y0, y1) = (620, 885);
        let mut col = Vec::new();
        for x in 1300..img.w {
            let mut s = 0f32;
            for y in y0..y1 {
                s += img.luma(x, y);
            }
            col.push((x, s / (y1 - y0) as f32));
        }
        for (x, v) in &col {
            println!("x {x} {v:.1}");
        }
        let mut row = Vec::new();
        for y in 590..910 {
            let mut s = 0f32;
            for x in 1325..1980 {
                s += img.luma(x, y);
            }
            row.push((y, s / 655.0));
        }
        for (y, v) in &row {
            println!("y {y} {v:.1}");
        }
    }

    /// Stack sizes as read by hand from the fixture (row by row).
    pub const EXPECTED: [[u32; 12]; 5] = [
        [40, 3, 20, 3, 30, 20, 300, 20, 20, 20, 11, 20],
        [4, 12, 20, 20, 16, 1, 247, 20, 20, 20, 20, 20],
        [1, 20, 20, 40, 37, 2, 20, 20, 20, 20, 20, 20],
        [10, 14, 8, 29, 30, 1, 2, 20, 20, 20, 20, 20],
        [10, 1, 20, 30, 20, 1, 20, 20, 20, 20, 20, 20],
    ];

    /// Builds digit templates from the fixture's known stack sizes and prints them as Rust constants.
    #[test]
    #[ignore]
    fn build_digit_templates() {
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let g = grid::locate(&img).unwrap();
        let mut sums: Vec<(Vec<f32>, u32)> = vec![(vec![0.0; text::GW * text::GH + 1], 0); 10];
        let mut bad = 0;
        for r in 0..grid::ROWS {
            for c in 0..grid::COLS {
                let (x, y, s) = g.cell_rect(c, r, 0.0);
                let q = img.crop(x, y, (s as f32 * 0.62) as usize, (s as f32 * 0.36) as usize);
                let gl = text::glyphs(&q);
                let digits: Vec<u32> = EXPECTED[r][c].to_string().chars().map(|ch| ch.to_digit(10).unwrap()).collect();
                if gl.len() != digits.len() {
                    println!("r{r} c{c}: {} glyphs for {}", gl.len(), EXPECTED[r][c]);
                    bad += 1;
                    continue;
                }
                for (gv, d) in gl.iter().zip(digits) {
                    let e = &mut sums[d as usize];
                    for (a, b) in e.0.iter_mut().zip(gv) {
                        *a += b;
                    }
                    e.1 += 1;
                }
            }
        }
        println!("segmentation mismatches: {bad}");
        for (d, (v, n)) in sums.iter().enumerate() {
            if *n == 0 {
                println!("// {d}: no samples");
                continue;
            }
            let vals: Vec<String> = v.iter().map(|x| format!("{:.2}", x / *n as f32)).collect();
            println!("({d}, [{}]), // {n} samples", vals.join(", "));
        }
    }

    #[test]
    #[ignore]
    fn read_fixture_digits() {
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let g = grid::locate(&img).unwrap();
        let (mut ok, mut wrong, mut none) = (0, 0, 0);
        for r in 0..grid::ROWS {
            let mut line = Vec::new();
            for c in 0..grid::COLS {
                let (x, y, s) = g.cell_rect(c, r, 0.0);
                let q = img.crop(x, y, (s as f32 * 0.62) as usize, (s as f32 * 0.36) as usize);
                let got = super::digits::read(&q);
                match got {
                    Some(v) if v.value == EXPECTED[r][c] => ok += 1,
                    Some(_) => wrong += 1,
                    None => none += 1,
                }
                line.push(got.map(|v| format!("{}{}({:.2})", v.value, if v.value == EXPECTED[r][c] { "" } else { "✗" }, v.confidence)).unwrap_or("-".into()));
            }
            println!("r{r} {}", line.join(" "));
        }
        println!("correct {ok}, wrong {wrong}, unread {none}");
    }

    #[test]
    #[ignore]
    fn recognise_fixture() {
        let refs = load_refs();
        let img = load_fixture("poe2-2560x1440-scaled-2000.webp");
        let (_, cells) = super::recognize::inventory(&refs, &img).unwrap();
        let mut by = std::collections::BTreeMap::<String, (u32, usize)>::new();
        for c in &cells {
            println!("r{} c{:02} {:7} {:?} x{:?} t{} | {:?}", c.row, c.col, c.confidence.as_str(), c.name, c.quantity, c.tier_strokes, c.alternatives.iter().take(2).collect::<Vec<_>>());
            if let Some(n) = &c.name {
                let e = by.entry(n.clone()).or_default();
                e.0 += c.quantity.unwrap_or(0);
                e.1 += 1;
            }
        }
        for (n, (q, k)) in by {
            println!("{n}: {q} in {k} cells");
        }
        let count = |c: Confidence| cells.iter().filter(|x| x.confidence == c).count();
        println!("cells {} high {} medium {} low {} unknown {}", cells.len(), count(Confidence::High), count(Confidence::Medium), count(Confidence::Low), count(Confidence::Unknown));
    }
}
