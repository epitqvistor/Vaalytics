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
/// 2: two grey conversions per screenshot (white label boxes), "3x" stack prefixes.
pub const RECOGNIZER_VERSION: i64 = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// Text as read by OCR.
    pub text: String,
    /// Best card (for unrecognized: only a suggestion).
    pub best: Option<Match>,
    pub verdict: Verdict,
    pub rect: Rect,
    /// Cards on this label: a "3x Divine Beauty" label is a stack of 3.
    pub quantity: u32,
}

/// Item labels on the ground use a small-caps font, which OCR returns in capitals ("THE LOVER"); UI
/// text, NPC names and the area panel are mixed case ("Milan (EU) Realm"). Mixed-case text that only
/// vaguely resembles a card is UI text, not an unreadable label (checked on two real screenshots).
pub fn mostly_lowercase(text: &str) -> bool {
    let (lower, letters) = text.chars().filter(|c| c.is_alphabetic()).fold((0, 0), |(l, n), c| (l + usize::from(c.is_lowercase()), n + 1));
    letters >= 3 && lower * 10 > letters * 3
}

/// "3x" / "3X" / "3×" before a card name (a stack on the ground) → 3. Only 2–99 (1x isn't shown).
pub fn stack_prefix(word: &str) -> Option<u32> {
    let w = word.trim();
    let digits = w.strip_suffix(['x', 'X', '×'])?;
    let n: u32 = digits.parse().ok()?;
    (2..=99).contains(&n).then_some(n)
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
    let mut ignored: Vec<Rect> = Vec::new();
    for line in lines {
        for mut group in split_line(line, 1.6) {
            // A stack prefix belongs to the label that follows it.
            let mut quantity = 1;
            if group.len() > 1 {
                if let Some(n) = stack_prefix(&line.words[group[0]].text) {
                    quantity = n;
                }
            }
            let full_rect = rect_of(line, &group);
            if quantity > 1 {
                group.remove(0);
            }
            let words: Vec<String> = group.iter().map(|&i| line.words[i].text.clone()).collect();
            let text = words.join(" ");
            let whole = matcher.best(&text);
            let verdict = whole.as_ref().map_or(Verdict::Ignore, |m| t.verdict(m));
            if matches!(verdict, Verdict::Confirmed) {
                out.detections.push(Detection { text, best: whole, verdict, rect: full_rect, quantity });
                continue;
            }
            // Several labels touching each other?
            if let Some(pieces) = matcher.segment(&words, t.review) {
                for (range, m) in pieces {
                    let idx = &group[range.clone()];
                    let v = t.verdict(&m);
                    let q = if range.start == 0 { quantity } else { 1 };
                    out.detections.push(Detection { text: words[range].join(" "), best: Some(m), verdict: v, rect: rect_of(line, idx), quantity: q });
                }
                continue;
            }
            let verdict = if verdict == Verdict::Unrecognized && mostly_lowercase(&text) { Verdict::Ignore } else { verdict };
            match verdict {
                Verdict::Ignore => ignored.push(full_rect),
                v => out.detections.push(Detection { text, best: whole, verdict: v, rect: full_rect, quantity }),
            }
        }
    }
    // The same label read twice (overlapping OCR boxes, or the two grey passes): overlapping boxes →
    // keep the better reading, whatever card each read found. Copies at other spots don't overlap.
    let rank = |d: &Detection| {
        let v = match d.verdict {
            Verdict::Confirmed => 3.0,
            Verdict::Review => 2.0,
            Verdict::Unrecognized => 1.0,
            Verdict::Ignore => 0.0,
        };
        v + d.best.as_ref().map_or(0.0, |m| m.score)
    };
    let mut kept: Vec<Detection> = Vec::new();
    for d in out.detections.drain(..) {
        if let Some(k) = kept.iter_mut().find(|k| k.rect.iou(&d.rect) > 0.5) {
            if rank(&d) > rank(k) {
                let q = k.quantity.max(d.quantity);
                *k = d;
                k.quantity = q;
            } else {
                k.quantity = k.quantity.max(d.quantity);
            }
            continue;
        }
        kept.push(d);
    }
    // Other text, counted once per spot and not where a card was found.
    let mut seen: Vec<Rect> = Vec::new();
    for r in ignored {
        if kept.iter().any(|k| k.rect.iou(&r) > 0.3) || seen.iter().any(|s| s.iou(&r) > 0.5) {
            continue;
        }
        seen.push(r);
    }
    out.ignored = seen.len();
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
            &[line(&["CHAOS", "ORB"], 100.0, &[]), line(&["SCROLL", "OF", "WISDOM"], 130.0, &[]), line(&["THE", "SURVIVALISF"], 160.0, &[]), line(&["THC", "DOCLAR"], 190.0, &[])],
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
    fn mixed_case_ui_text_is_not_an_unreadable_label() {
        assert!(mostly_lowercase("Milan (EU) Realm"));
        assert!(!mostly_lowercase("THE LOVER"));
        assert!(!mostly_lowercase("3X"));
        let m = Matcher::new(["The Realm", "The Lover"].map(String::from));
        // UI text that vaguely resembles a card: ignored.
        let r = recognize(&[line(&["EL)),", "Realm"], 100.0, &[])], &m, Thresholds::default());
        assert!(r.detections.is_empty());
        assert_eq!(r.ignored, 1);
        // A clean mixed-case read of a card still counts.
        let r = recognize(&[line(&["The", "Lover"], 100.0, &[])], &m, Thresholds::default());
        assert_eq!(r.detections[0].verdict, Verdict::Confirmed);
    }

    #[test]
    fn stack_prefixes() {
        assert_eq!(stack_prefix("3x"), Some(3));
        assert_eq!(stack_prefix("3X"), Some(3));
        assert_eq!(stack_prefix("12×"), Some(12));
        assert_eq!(stack_prefix("1x"), None);
        assert_eq!(stack_prefix("x"), None);
        assert_eq!(stack_prefix("The"), None);
        let m = Matcher::new(["Divine Beauty", "Lonely Warrior"].map(String::from));
        let r = recognize(&[line(&["3X", "DIVINE", "BEAUTY"], 100.0, &[]), line(&["LONELY", "WARRIOR"], 140.0, &[])], &m, Thresholds::default());
        let got: Vec<_> = r.detections.iter().map(|d| (d.best.as_ref().unwrap().card.as_str(), d.quantity, d.verdict)).collect();
        assert_eq!(got, [("Divine Beauty", 3, Verdict::Confirmed), ("Lonely Warrior", 1, Verdict::Confirmed)]);
    }

    #[test]
    fn two_passes_over_one_label_keep_the_better_read() {
        // Pass 1 garbled, pass 2 clean, same box.
        let bad = line(&["LONEI.Y", "V,/ARRIOR"], 100.0, &[]);
        let good = line(&["LONELY", "WARRIOR"], 100.0, &[]);
        let m = Matcher::new(["Lonely Warrior", "Divine Beauty"].map(String::from));
        let r = recognize(&[bad, good], &m, Thresholds::default());
        assert_eq!(r.detections.len(), 1);
        assert_eq!(r.detections[0].verdict, Verdict::Confirmed);
        // The same UI text read twice is counted once.
        let ui = recognize(&[line(&["WAYPOINT"], 300.0, &[]), line(&["WAYPOINT"], 300.0, &[])], &m, Thresholds::default());
        assert_eq!(ui.ignored, 1);
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
            println!("{:?} {:>5.2} {:<32} x{} <- {:?}", d.verdict, d.best.as_ref().map_or(0.0, |b| b.score), d.best.as_ref().map_or("", |b| b.card.as_str()), d.quantity, d.text);
        }
        println!("ocr {ocr_ms} ms, {} lines, {} detections, {} ignored", r.ocr_lines, r.detections.len(), r.ignored);
    }
}
