//! Matching OCR text against the known Divination Card names.
//!
//! OCR output is imperfect ("The Lovcr", "Rain ot Chaos", two labels merged into one line). Text is
//! normalised (case, punctuation, apostrophes), compared by edit distance and turned into a similarity
//! 0–1. A line that holds several labels side by side is split at wide gaps between words and, failing
//! that, segmented into consecutive card names. The result never guesses: below the thresholds a
//! line is "unrecognized" (shown to the user) or ignored as other ground text.

use serde::Serialize;

/// Lower-case letters and digits, single spaces; apostrophes and punctuation removed.
pub fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_alphanumeric() {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.extend(c.to_lowercase());
        } else if c.is_whitespace() || c == '-' || c == '_' {
            space = true;
        }
        // apostrophes, commas, dots…: dropped without a space ("King's" → "kings")
    }
    out
}

/// Levenshtein distance on chars (small strings; O(n·m)).
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// 1 − distance / longer length; short names are penalised (one wrong letter in "Rats" is a lot).
pub fn similarity(a: &str, b: &str) -> f64 {
    let n = a.chars().count().max(b.chars().count());
    if n == 0 {
        return 0.0;
    }
    let s = 1.0 - levenshtein(a, b) as f64 / n as f64;
    if n < 6 && a != b {
        s - 0.1
    } else {
        s
    }
}

/// Card names prepared for matching.
#[derive(Debug, Clone)]
pub struct Matcher {
    names: Vec<String>,
    norm: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub card: String,
    /// Similarity of the best match, 0–1.
    pub score: f64,
    /// Best different card's similarity (ambiguity), 0 when none.
    pub runner_up: f64,
    pub runner_up_card: Option<String>,
}

impl Matcher {
    pub fn new<I: IntoIterator<Item = String>>(names: I) -> Self {
        let mut names: Vec<String> = names.into_iter().filter(|n| !normalize(n).is_empty()).collect();
        names.sort();
        names.dedup();
        let norm = names.iter().map(|n| normalize(n)).collect();
        Self { names, norm }
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Exact (normalised) lookup: the canonical card name.
    pub fn canonical(&self, name: &str) -> Option<&str> {
        let n = normalize(name);
        self.norm.iter().position(|x| *x == n).map(|i| self.names[i].as_str())
    }

    /// Best card for a piece of text (already normalised or not).
    pub fn best(&self, text: &str) -> Option<Match> {
        let t = normalize(text);
        if t.chars().count() < 3 {
            return None;
        }
        let mut best: Option<(usize, f64)> = None;
        let mut second = 0.0f64;
        let mut second_i: Option<usize> = None;
        for (i, n) in self.norm.iter().enumerate() {
            // Cheap length filter: a big length gap can't be similar.
            let (lt, ln) = (t.chars().count() as f64, n.chars().count() as f64);
            if (lt - ln).abs() / lt.max(ln) > 0.5 {
                continue;
            }
            let s = similarity(&t, n);
            match best {
                Some((_, b)) if s <= b => {
                    if s > second {
                        second = s;
                        second_i = Some(i);
                    }
                }
                _ => {
                    if let Some((bi, b)) = best {
                        second = b;
                        second_i = Some(bi);
                    }
                    best = Some((i, s));
                }
            }
        }
        best.map(|(i, s)| Match { card: self.names[i].clone(), score: s.max(0.0), runner_up: second.max(0.0), runner_up_card: second_i.map(|j| self.names[j].clone()) })
    }

    /// Splits a run of words (one OCR line segment) into consecutive card names when the whole run
    /// isn't one card. Returns (word range, match) pieces covering every word, or None when no split
    /// beats reading the run as one label.
    pub fn segment(&self, words: &[String], min_score: f64) -> Option<Vec<(std::ops::Range<usize>, Match)>> {
        let n = words.len();
        if n < 2 || n > 40 {
            return None;
        }
        // best[i] = (total score weighted by words, pieces) for words[..i]
        let mut best: Vec<Option<(f64, Vec<(std::ops::Range<usize>, Match)>)>> = vec![None; n + 1];
        best[0] = Some((0.0, Vec::new()));
        for end in 1..=n {
            for start in end.saturating_sub(7)..end {
                let Some((acc, pieces)) = best[start].clone() else { continue };
                let text = words[start..end].join(" ");
                let Some(m) = self.best(&text) else { continue };
                if m.score < min_score {
                    continue;
                }
                let total = acc + m.score * (end - start) as f64;
                if best[end].as_ref().is_none_or(|(b, _)| total > *b) {
                    let mut p = pieces;
                    p.push((start..end, m));
                    best[end] = Some((total, p));
                }
            }
        }
        let (_, pieces) = best[n].take()?;
        (pieces.len() > 1).then_some(pieces)
    }
}

/// How sure a match is, given the user's thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Confirmed,
    Review,
    Unrecognized,
    /// Not card text (another ground item, UI text) — dropped, only counted.
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Thresholds {
    /// At or above (and unambiguous): confirmed without review.
    pub auto_confirm: f64,
    /// At or above: a plausible card, shown for review.
    pub review: f64,
    /// At or above: card-like text with no reliable match ("unrecognized").
    pub unrecognized: f64,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { auto_confirm: 0.9, review: 0.7, unrecognized: 0.6 }
    }
}

impl Thresholds {
    pub fn sanitized(self) -> Self {
        let c = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
        let auto_confirm = c(self.auto_confirm, 0.6, 1.0);
        let review = c(self.review, 0.4, auto_confirm);
        let unrecognized = c(self.unrecognized, 0.3, review);
        Self { auto_confirm, review, unrecognized }
    }

    pub fn verdict(&self, m: &Match) -> Verdict {
        // Two different cards almost equally close: never auto-confirm.
        let ambiguous = m.runner_up > 0.0 && m.score - m.runner_up < 0.08;
        if m.score >= self.auto_confirm && !ambiguous {
            Verdict::Confirmed
        } else if m.score >= self.review {
            Verdict::Review
        } else if m.score >= self.unrecognized {
            Verdict::Unrecognized
        } else {
            Verdict::Ignore
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m() -> Matcher {
        Matcher::new(
            ["The Lover", "Rain of Chaos", "The King's Blade", "The Catalyst", "Rats", "The Wolf", "The Wolf's Shadow", "Emperor's Luck", "The Doctor", "The Survivalist", "Destined to Crumble"]
                .map(String::from),
        )
    }

    #[test]
    fn normalizes_case_and_punctuation() {
        assert_eq!(normalize("  The King’s  Blade! "), "the kings blade");
        assert_eq!(normalize("The King's Blade"), "the kings blade");
        assert_eq!(normalize("Rain-of_Chaos"), "rain of chaos");
    }

    #[test]
    fn exact_and_noisy_matches() {
        let m = m();
        let e = m.best("The Lover").unwrap();
        assert_eq!((e.card.as_str(), e.score), ("The Lover", 1.0));
        let n = m.best("Rain ot Chaos").unwrap();
        assert_eq!(n.card, "Rain of Chaos");
        assert!(n.score > 0.9);
        let k = m.best("The Kings Blade").unwrap();
        assert_eq!(k.card, "The King's Blade");
        assert_eq!(k.score, 1.0);
        assert_eq!(m.canonical("the kings blade"), Some("The King's Blade"));
    }

    #[test]
    fn short_names_and_unrelated_text() {
        let m = m();
        let t = Thresholds::default();
        // One wrong letter in a 4-letter name is not auto-confirmed.
        let r = m.best("Rais").unwrap();
        assert_eq!(r.card, "Rats");
        assert_ne!(t.verdict(&r), Verdict::Confirmed);
        // Currency on the ground is not a card.
        let c = m.best("Chaos Orb");
        assert!(c.as_ref().is_none_or(|c| t.verdict(c) == Verdict::Ignore), "{c:?}");
        assert!(m.best("ab").is_none());
    }

    #[test]
    fn verdicts_follow_thresholds_and_ambiguity() {
        let t = Thresholds::default();
        let mk = |score, runner_up| Match { card: "X".into(), score, runner_up, runner_up_card: None };
        assert_eq!(t.verdict(&mk(1.0, 0.0)), Verdict::Confirmed);
        assert_eq!(t.verdict(&mk(0.95, 0.9)), Verdict::Review, "ambiguous");
        assert_eq!(t.verdict(&mk(0.8, 0.0)), Verdict::Review);
        assert_eq!(t.verdict(&mk(0.6, 0.0)), Verdict::Unrecognized);
        assert_eq!(t.verdict(&mk(0.3, 0.0)), Verdict::Ignore);
        let s = Thresholds { auto_confirm: 2.0, review: 0.1, unrecognized: f64::NAN }.sanitized();
        assert!(s.auto_confirm <= 1.0 && s.review >= 0.4 && s.unrecognized >= 0.3 && s.unrecognized <= s.review);
    }

    #[test]
    fn segments_merged_labels() {
        let m = m();
        let words: Vec<String> = "The Lover The Catalyst Rain of Chaos".split(' ').map(String::from).collect();
        let pieces = m.segment(&words, 0.7).unwrap();
        let cards: Vec<&str> = pieces.iter().map(|(_, m)| m.card.as_str()).collect();
        assert_eq!(cards, ["The Lover", "The Catalyst", "Rain of Chaos"]);
        // A single card is not split.
        let one: Vec<String> = "Destined to Crumble".split(' ').map(String::from).collect();
        assert!(m.segment(&one, 0.7).is_none());
    }
}
