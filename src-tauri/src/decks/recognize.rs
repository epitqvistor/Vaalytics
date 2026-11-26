//! From OCR lines to card detections (one per ground label).
//!
//! 1. Each OCR line is split where the gap between two words is much wider than a space — two labels
//!    side by side in one text row.
//! 2. Each piece is matched as one card name; failing that, it is segmented into consecutive names
//!    (labels touching each other).
//! 3. Verdicts follow the user's thresholds: confirmed / review / unrecognized; other text (currency,
//!    gear, UI) is ignored and only counted.
//! 4. The same label read twice (overlapping OCR boxes, same card) is kept once. Two copies of a card at
//!    different places are two detections — copies are legitimate.

use super::matching::{Match, Matcher, Thresholds, Verdict};
use super::ocr::{Line, Rect};
use serde::Serialize;

/// Bump when recognition output changes (stored on every capture).
pub const RECOGNIZER_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// Text as read by OCR.
    pub text: String,
    /// Best card (for unrecognized: only a suggestion).
    pub best: Option<Match>,
    pub verdict: Verdict,
    pub rect: Rect,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recognition {
    pub detections: Vec<Detection>,
    pub ocr_lines: usize,
    /// Pieces of text that matched no card (other ground items, UI).
    pub ignored: usize,
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    v[v.len() / 2]
}

/// Splits a line's words where the horizontal gap exceeds `gap_factor` × the line's word height.
fn split_line(line: &Line, gap_factor: f64) -> Vec<Vec<usize>> {
    let height = median(line.words.iter().map(|w| w.rect.h).collect()).max(1.0);
    let mut order: Vec<usize> = (0..line.words.len()).collect();
    order.sort_by(|&a, &b| line.words[a].rect.x.total_cmp(&line.words[b].rect.x));
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut prev_end: Option<f64> = None;
    for i in order {
        let r = &line.words[i].rect;
        let new_group = prev_end.is_none_or(|e| r.x - e > gap_factor * height);
        if new_group {
            groups.push(vec![i]);
        } else if let Some(g) = groups.last_mut() {
            g.push(i);
        }
        prev_end = Some(prev_end.map_or(r.x + r.w, |e: f64| e.max(r.x + r.w)));
    }
    groups
}

fn rect_of(line: &Line, idx: &[usize]) -> Rect {
    idx.iter().map(|&i| line.words[i].rect.clone()).reduce(|a, b| a.union(&b)).unwrap_or(Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 })
}

pub fn recognize(lines: &[Line], matcher: &Matcher, t: Thresholds) -> Recognition {
    let t = t.sanitized();
    let mut out = Recognition { ocr_lines: lines.len(), ..Default::default() };
    for line in lines {
        for group in split_line(line, 1.6) {
            let words: Vec<String> = group.iter().map(|&i| line.words[i].text.clone()).collect();
            let text = words.join(" ");
            let whole = matcher.best(&text);
            let verdict = whole.as_ref().map_or(Verdict::Ignore, |m| t.verdict(m));
            if matches!(verdict, Verdict::Confirmed) {
                out.detections.push(Detection { text, best: whole, verdict, rect: rect_of(line, &group) });
                continue;
            }
            // Several labels touching each other?
            if let Some(pieces) = matcher.segment(&words, t.review) {
                for (range, m) in pieces {
                    let idx = &group[range.clone()];
                    let v = t.verdict(&m);
                    out.detections.push(Detection { text: words[range].join(" "), best: Some(m), verdict: v, rect: rect_of(line, idx) });
                }
                continue;
            }
            match verdict {
                Verdict::Ignore => out.ignored += 1,
                v => out.detections.push(Detection { text, best: whole, verdict: v, rect: rect_of(line, &group) }),
            }
        }
    }
    // The same label read twice: same card, overlapping boxes → keep the better reading.
    let mut kept: Vec<Detection> = Vec::new();
    for d in out.detections.drain(..) {
        let card = d.best.as_ref().map(|m| m.card.clone());
        if let Some(k) = kept.iter_mut().find(|k| k.best.as_ref().map(|m| &m.card) == card.as_ref() && k.rect.iou(&d.rect) > 0.5) {
            if d.best.as_ref().map_or(0.0, |m| m.score) > k.best.as_ref().map_or(0.0, |m| m.score) {
                *k = d;
            }
            continue;
        }
        kept.push(d);
    }
    // Top to bottom, left to right — the order the user reads the screen in.
    kept.sort_by(|a, b| (a.rect.y / 8.0).floor().total_cmp(&(b.rect.y / 8.0).floor()).then(a.rect.x.total_cmp(&b.rect.x)));
    out.detections = kept;
    out
}

/// A detection from an earlier capture that is probably the same physical label: same card, centre
/// within `tolerance` (fraction of the capture's larger side). Only asked about, never dropped.
pub fn same_spot(a: &Rect, a_size: (f64, f64), b: &Rect, b_size: (f64, f64), tolerance: f64) -> bool {
    if a_size != b_size {
        return false;
    }
    let (ax, ay) = a.center();
    let (bx, by) = b.center();
    let span = a_size.0.max(a_size.1).max(1.0);
    ((ax - bx).powi(2) + (ay - by).powi(2)).sqrt() / span <= tolerance
}

#[cfg(test)]
mod tests {
    use super::super::ocr::Word;
    use super::*;

    fn matcher() -> Matcher {
        Matcher::new(["The Lover", "Rain of Chaos", "The Catalyst", "The Doctor", "Emperor's Luck", "The Survivalist", "Rats"].map(String::from))
    }

    /// One OCR line of words placed left to right; `gap` after each word index in `wide`.
    fn line(words: &[&str], y: f64, wide_after: &[usize]) -> Line {
        let mut x = 10.0;
        let mut out = Vec::new();
        for (i, w) in words.iter().enumerate() {
            let width = w.len() as f64 * 9.0;
            out.push(Word { text: w.to_string(), rect: Rect { x, y, w: width, h: 16.0 } });
            x += width + if wide_after.contains(&i) { 80.0 } else { 6.0 };
        }
        Line { words: out }
    }

    #[test]
    fn single_and_multiple_cards() {
        let r = recognize(&[line(&["The", "Lover"], 100.0, &[])], &matcher(), Thresholds::default());
        assert_eq!(r.detections.len(), 1);
        assert_eq!(r.detections[0].verdict, Verdict::Confirmed);
        // Two labels in one row, separated by a wide gap; a third read with OCR noise.
        let r = recognize(
            &[line(&["Rain", "of", "Chaos", "The", "Catalyst"], 100.0, &[2]), line(&["Emperors", "Luck"], 140.0, &[])],
            &matcher(),
            Thresholds::default(),
        );
        let cards: Vec<_> = r.detections.iter().map(|d| d.best.as_ref().unwrap().card.as_str()).collect();
        assert_eq!(cards, ["Rain of Chaos", "The Catalyst", "Emperor's Luck"]);
        assert!(r.detections.iter().all(|d| d.verdict == Verdict::Confirmed));
    }

    #[test]
    fn copies_of_one_card_are_kept() {
        let r = recognize(&[line(&["The", "Lover"], 100.0, &[]), line(&["The", "Lover"], 200.0, &[])], &matcher(), Thresholds::default());
        assert_eq!(r.detections.len(), 2);
    }

    #[test]
    fn touching_labels_are_segmented() {
        // No wide gap: "The Lover The Doctor" read as one run.
        let r = recognize(&[line(&["The", "Lover", "The", "Doctor"], 100.0, &[])], &matcher(), Thresholds::default());
        let cards: Vec<_> = r.detections.iter().map(|d| d.best.as_ref().unwrap().card.as_str()).collect();
        assert_eq!(cards, ["The Lover", "The Doctor"]);
    }

    #[test]
    fn unrelated_items_and_noise() {
        let r = recognize(
            &[line(&["Chaos", "Orb"], 100.0, &[]), line(&["Scroll", "of", "Wisdom"], 130.0, &[]), line(&["The", "Survivalisf"], 160.0, &[]), line(&["Thc", "Doclar"], 190.0, &[])],
            &matcher(),
            Thresholds::default(),
        );
        assert_eq!(r.ignored, 2, "{r:?}");
        assert_eq!(r.detections.len(), 2);
        assert_eq!(r.detections[0].best.as_ref().unwrap().card, "The Survivalist");
        assert_eq!(r.detections[0].verdict, Verdict::Confirmed);
        // Heavily garbled: plausible but not confirmed.
        assert_eq!(r.detections[1].best.as_ref().unwrap().card, "The Doctor");
        assert_ne!(r.detections[1].verdict, Verdict::Confirmed);
    }

    #[test]
    fn empty_screen() {
        let r = recognize(&[], &matcher(), Thresholds::default());
        assert!(r.detections.is_empty());
        assert_eq!(r.ignored, 0);
    }

    #[test]
    fn duplicate_reading_of_one_label_is_merged() {
        let a = line(&["The", "Lover"], 100.0, &[]);
        let mut b = a.clone();
        b.words[1].text = "Lovar".into();
        let r = recognize(&[a, b], &matcher(), Thresholds::default());
        assert_eq!(r.detections.len(), 1);
        assert_eq!(r.detections[0].text, "The Lover");
    }

    #[test]
    fn same_spot_tolerance() {
        let a = Rect { x: 100.0, y: 100.0, w: 80.0, h: 16.0 };
        let b = Rect { x: 110.0, y: 104.0, w: 80.0, h: 16.0 };
        let far = Rect { x: 600.0, y: 100.0, w: 80.0, h: 16.0 };
        assert!(same_spot(&a, (1920.0, 1080.0), &b, (1920.0, 1080.0), 0.02));
        assert!(!same_spot(&a, (1920.0, 1080.0), &far, (1920.0, 1080.0), 0.02));
        assert!(!same_spot(&a, (1920.0, 1080.0), &b, (1280.0, 720.0), 0.02));
    }

    /// Real screenshot fixture + real OCR + the cached card list (`DECK_CARDS_JSON=<data dir>/decks/cards.json`).
    #[test]
    #[ignore]
    fn real_ground_screenshot() {
        let cards: serde_json::Value = serde_json::from_slice(&std::fs::read(std::env::var("DECK_CARDS_JSON").expect("DECK_CARDS_JSON")).unwrap()).unwrap();
        let names = cards["cards"].as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap().to_string());
        let m = Matcher::new(names);
        let name = std::env::var("DECK_FIXTURE").unwrap_or_else(|_| "ground-2000x1070-filter-blue.webp".into());
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/decks").join(name);
        let img = image::open(&path).unwrap().to_rgba8();
        let img = crate::loot::inventory::image::Rgba::from_raw(img.width() as usize, img.height() as usize, img.into_raw()).unwrap();
        let t0 = std::time::Instant::now();
        let lines = super::super::ocr::recognize(&img).unwrap();
        let ocr_ms = t0.elapsed().as_millis();
        for l in &lines {
            println!("OCR {:?}", l.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>());
        }
        let r = recognize(&lines, &m, Thresholds::default());
        for d in &r.detections {
            println!("{:?} {:>5.2} {:<32} <- {:?}", d.verdict, d.best.as_ref().map_or(0.0, |b| b.score), d.best.as_ref().map_or("", |b| b.card.as_str()), d.text);
        }
        println!("ocr {ocr_ms} ms, {} lines, {} detections, {} ignored", r.ocr_lines, r.detections.len(), r.ignored);
    }
}
