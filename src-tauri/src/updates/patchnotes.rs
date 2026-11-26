//! Patch Notes Intelligence: discovery of official articles (forum patch-note lists and
//! the news RSS feed), extraction of the first post of a thread and deterministic,
//! rule-based classification of its lines. Patch notes are information: nothing here
//! changes a dataset or application logic.

use crate::game::GameId;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const POE1_FORUM: &str = "https://www.pathofexile.com/forum/view-forum/patch-notes";
pub const POE2_FORUM: &str = "https://www.pathofexile.com/forum/view-forum/2212";
pub const NEWS_RSS: &str = "https://www.pathofexile.com/news/rss";
pub const THREAD_BASE: &str = "https://www.pathofexile.com/forum/view-thread/";
pub const CLASSIFIER: &str = "keyword rules v1";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Discovered {
    pub id: String,
    pub game: Option<GameId>,
    pub kind: &'static str,
    pub title: String,
    pub url: String,
    pub published_at: Option<i64>,
}

// ---------- text helpers ----------

pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn clean(s: &str) -> String {
    decode_entities(&strip_tags(s)).split_whitespace().collect::<Vec<_>>().join(" ")
}

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn month(s: &str) -> Option<i64> {
    let s = s.to_ascii_lowercase();
    MONTHS.iter().position(|m| s.starts_with(m)).map(|i| i as i64 + 1)
}

fn hms(s: &str) -> Option<(i64, i64, i64)> {
    let mut p = s.split(':').map(|x| x.trim().parse::<i64>());
    Some((p.next()?.ok()?, p.next()?.ok()?, p.next().and_then(Result::ok).unwrap_or(0)))
}

/// RFC 2822 date as used by RSS: "Wed, 18 Nov 2026 03:11:12 +0000".
pub fn parse_rfc2822(s: &str) -> Option<i64> {
    let s = s.split_once(',').map(|(_, r)| r).unwrap_or(s);
    let p: Vec<&str> = s.split_whitespace().collect();
    if p.len() < 4 {
        return None;
    }
    let (d, m, y) = (p[0].parse::<i64>().ok()?, month(p[1])?, p[2].parse::<i64>().ok()?);
    let (hh, mm, ss) = hms(p[3])?;
    let offset = p.get(4).and_then(|z| {
        let sign = if z.starts_with('-') { -1 } else { 1 };
        let digits = z.trim_start_matches(['+', '-']);
        if digits.len() != 4 {
            return None;
        }
        Some(sign * (digits[..2].parse::<i64>().ok()? * 3600 + digits[2..].parse::<i64>().ok()? * 60))
    });
    Some(days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss - offset.unwrap_or(0))
}

/// Forum date "Nov 23, 2026, 12:44:19 AM". The forum doesn't state a time zone; read as UTC.
pub fn parse_forum_date(s: &str) -> Option<i64> {
    let s = s.trim().trim_start_matches(',').trim();
    let p: Vec<&str> = s.split([',', ' ']).filter(|x| !x.is_empty()).collect();
    if p.len() < 4 {
        return None;
    }
    let (m, d, y) = (month(p[0])?, p[1].parse::<i64>().ok()?, p[2].parse::<i64>().ok()?);
    let (mut hh, mm, ss) = hms(p[3])?;
    match p.get(4).map(|x| x.to_ascii_uppercase()) {
        Some(ref ap) if ap == "PM" && hh < 12 => hh += 12,
        Some(ref ap) if ap == "AM" && hh == 12 => hh = 0,
        _ => {}
    }
    Some(days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss)
}

fn thread_id(href: &str) -> Option<String> {
    let i = href.find("/forum/view-thread/")?;
    let id: String = href[i + 19..].chars().take_while(char::is_ascii_digit).collect();
    (!id.is_empty()).then_some(id)
}

fn kind_of(title: &str, default: &'static str) -> &'static str {
    let t = title.to_ascii_lowercase();
    if t.contains("hotfix") {
        "hotfix"
    } else if t.contains("patch notes") || t.contains("patch note") {
        "patch_notes"
    } else if t.contains("announc") || t.contains("launch") || t.contains("reveal") || t.contains("league") {
        "announcement"
    } else {
        default
    }
}

/// Game named in a title, if any.
pub fn game_of(title: &str) -> Option<GameId> {
    let t = title.to_ascii_lowercase();
    if t.contains("path of exile 2") || t.contains("poe 2") || t.contains("poe2") || t.contains("early access") {
        Some(GameId::Poe2)
    } else if t.contains("path of exile 1") || t.contains("poe 1") || t.contains("poe1") {
        Some(GameId::Poe1)
    } else {
        None
    }
}

// ---------- discovery ----------

/// Thread list of a patch-notes forum page.
pub fn parse_forum_list(html: &str, game: GameId) -> Vec<Discovered> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("<div class=\"title\">") {
        rest = &rest[i + 19..];
        let Some(a) = rest.find("<a href=\"") else { break };
        let after = &rest[a + 9..];
        let Some(q) = after.find('"') else { break };
        let href = &after[..q];
        let Some(gt) = after.find('>') else { break };
        let Some(end) = after[gt..].find("</a>") else { break };
        let title = clean(&after[gt + 1..gt + end]);
        let window = &after[..after.len().min(4000)];
        let published_at = window.find("<span class=\"post_date\">").and_then(|p| {
            let s = &window[p + 24..];
            s.find("</span>").and_then(|e| parse_forum_date(&s[..e]))
        });
        if let Some(id) = thread_id(href) {
            if !title.is_empty() && !out.iter().any(|d: &Discovered| d.id == id) {
                out.push(Discovered { url: format!("{THREAD_BASE}{id}"), id, game: Some(game), kind: kind_of(&title, "patch_notes"), title, published_at });
            }
        }
    }
    out
}

fn tag<'a>(item: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let i = item.find(&open)? + open.len();
    let e = item[i..].find(&format!("</{name}>"))?;
    let v = &item[i..i + e];
    Some(v.trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>"))
}

/// Items of the official news RSS feed.
pub fn parse_rss(xml: &str) -> Vec<Discovered> {
    xml.split("<item>")
        .skip(1)
        .filter_map(|item| {
            let item = item.split("</item>").next()?;
            let title = clean(tag(item, "title")?);
            let link = decode_entities(tag(item, "link")?);
            if !link.starts_with("https://www.pathofexile.com/") || title.is_empty() {
                return None;
            }
            let id = thread_id(&link).unwrap_or_else(|| link.clone());
            Some(Discovered { id, game: game_of(&title), kind: kind_of(&title, "news"), title, url: link, published_at: tag(item, "pubDate").and_then(parse_rfc2822) })
        })
        .collect()
}

// ---------- thread content ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line {
    pub text: String,
    pub heading: bool,
}

/// Lines of the first post of a forum thread.
pub fn first_post_lines(html: &str) -> Option<Vec<Line>> {
    let start = html.find("<div class=\"contentStart\"></div>")?;
    let rest = &html[start..];
    let c = rest.find("<div class=\"content\">")? + 21;
    let body = &rest[c..];
    let end = body.find("<div class=\"signature\">").or_else(|| body.find("</td>")).unwrap_or(body.len());
    let body = &body[..end];
    // Mark headings, then break on block tags.
    let mut marked = String::with_capacity(body.len());
    let lower = body.to_ascii_lowercase();
    let mut i = 0;
    while i < body.len() {
        let rest_l = &lower[i..];
        let heading_open = ["<h1", "<h2", "<h3", "<h4", "<strong"].iter().any(|t| rest_l.starts_with(t));
        let block = ["<br", "</li", "<li", "</p", "<p", "</h1", "</h2", "</h3", "</h4", "</div", "<div", "<ul", "</ul", "<tr", "</strong"].iter().any(|t| rest_l.starts_with(t));
        if heading_open {
            marked.push_str("\n\u{1}");
        } else if block {
            marked.push('\n');
        }
        let ch = body[i..].chars().next().unwrap();
        marked.push(ch);
        i += ch.len_utf8();
    }
    let lines: Vec<Line> = strip_tags(&marked)
        .split('\n')
        .map(|l| {
            let heading = l.starts_with('\u{1}');
            let text = decode_entities(l.trim_start_matches('\u{1}')).split_whitespace().collect::<Vec<_>>().join(" ");
            Line { text: text.chars().take(600).collect(), heading }
        })
        .filter(|l| !l.text.is_empty())
        .take(3000)
        .collect();
    // A "heading" that is a full sentence (bold inline text) is an ordinary line.
    Some(lines.into_iter().map(|l| Line { heading: l.heading && l.text.len() < 90 && !l.text.ends_with('.'), ..l }).collect())
}

// ---------- classification ----------

struct Rule {
    category: &'static str,
    any: &'static [&'static str],
    /// Specific terms → high confidence; generic → needs review.
    specific: bool,
}

const RULES: &[Rule] = &[
    Rule { category: "bugfix", any: &["fixed a bug", "fixed an issue", "fixed "], specific: true },
    Rule { category: "divination", any: &["divination card"], specific: true },
    Rule { category: "ultimatum", any: &["ultimatum", "trialmaster"], specific: true },
    Rule { category: "mercenaries", any: &["mercenar", "warrant", "proving grounds"], specific: true },
    Rule { category: "quests", any: &["quest"], specific: false },
    Rule { category: "rewards", any: &["passive skill point", "reward", "ascendancy point", "permanent bonus"], specific: false },
    Rule { category: "campaign", any: &["campaign", "waypoint", "checkpoint", " act 1", " act 2", " act 3", " act 4", " act 5", " act 6", " act 7", " act 8", " act 9", " act 10", "interlude"], specific: false },
    Rule { category: "bosses", any: &["boss", "pinnacle", "uber "], specific: false },
    Rule { category: "currency", any: &["currency", " orb", "orb of", "scarab", "splinter", "catalyst"], specific: false },
    Rule { category: "crafting", any: &["crafting", "essence", "fossil", "omen", "harvest", "recombinator", "crafting bench", "veiled", "eldritch"], specific: false },
    Rule { category: "skills", any: &["skill gem", "support gem", "skill", " gem"], specific: false },
    Rule { category: "uniques", any: &["unique"], specific: false },
    Rule { category: "items", any: &["item", "base type", "modifier", "affix", "implicit"], specific: false },
    Rule { category: "mechanics", any: &["league mechanic", "atlas", "endgame", "map device", "delirium", "breach", "expedition", "ritual", "abyss", "legion", "heist", "sanctum", "trial of", "tablet", "precursor"], specific: false },
    Rule { category: "balance", any: &["increased", "reduced", "now deals", "now grants", "now has", "no longer", "damage", "changed"], specific: false },
    Rule { category: "performance", any: &["performance", "crash", "stability", "memory"], specific: true },
];

pub fn categorize(line: &str) -> Vec<&'static str> {
    let l = format!(" {} ", line.to_ascii_lowercase());
    RULES.iter().filter(|r| r.any.iter().any(|k| l.contains(k))).map(|r| r.category).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub category: &'static str,
    pub lines: usize,
    pub datasets: Vec<&'static str>,
    pub modules: Vec<&'static str>,
    /// "data" — the dataset can follow from a data update; "developer" — needs application code
    /// or bundled data changes; "info" — no Vaalytics data depends on it.
    pub action: &'static str,
    pub recommendation: &'static str,
    pub confidence: &'static str,
    pub examples: Vec<String>,
}

/// Which Vaalytics data a category of change can affect (from the module registry).
fn impact_of(game: Option<GameId>, category: &str) -> (Vec<&'static str>, &'static str, &'static str) {
    use GameId::*;
    match (game, category) {
        (Some(Poe1), "divination") => (vec!["poe1.divination-cards"], "data", "Run Check for Updates once RePoE has exported the new game files; Deck Intelligence follows the installed card list."),
        (Some(g), "currency") => (vec![if g == Poe1 { "poe1.market-prices" } else { "poe2.market-prices" }], "data", "Prices follow automatically from poe.ninja; new currencies appear when poe.ninja lists them."),
        (Some(Poe1), "crafting") => (vec!["poe1.crafting-data"], "developer", "Modifier data refreshes from RePoE, but changed crafting rules need a Crafting engine update (developer)."),
        (Some(Poe1), "mercenaries") => (vec!["poe1.mercenary-catalog"], "developer", "The mercenary catalog ships with the app; new skills, supports or families need a regenerated catalog (developer)."),
        (Some(Poe1), "ultimatum") => (vec!["poe1.ultimatum-modifiers"], "developer", "The Ultimatum modifier list ships with the app; new or removed modifiers need an app update (developer)."),
        (Some(Poe1), "quests" | "campaign" | "rewards") => (vec!["poe1.campaign"], "developer", "PoE 1 campaign data ships with the app; route or reward changes need an app update (developer)."),
        (Some(Poe2), "quests" | "campaign" | "rewards" | "bosses") => (vec!["poe2.campaign"], "developer", "PoE 2 campaign data ships with the app; route or reward changes need an app update (developer)."),
        (_, "mechanics") => (vec![], "developer", "No Vaalytics dataset covers league mechanics; a new or reworked mechanic may need module changes (developer review)."),
        _ => (vec![], "info", "Information only — no Vaalytics data depends on this."),
    }
}

/// Deterministic analysis of a patch-note post.
pub fn analyze(game: Option<GameId>, title: &str, lines: &[Line]) -> Value {
    let mut sections: Vec<Value> = Vec::new();
    let mut current = String::new();
    let mut by_cat: BTreeMap<&'static str, Vec<String>> = BTreeMap::new();
    let mut section_lines: Vec<Value> = Vec::new();
    let mut classified = 0usize;
    let flush = |sections: &mut Vec<Value>, title: &str, lines: &mut Vec<Value>| {
        if !lines.is_empty() {
            sections.push(json!({ "title": title, "lines": std::mem::take(lines) }));
        }
    };
    for l in lines {
        if l.heading {
            flush(&mut sections, &current, &mut section_lines);
            current = l.text.clone();
            continue;
        }
        let cats = categorize(&l.text);
        if !cats.is_empty() {
            classified += 1;
            for c in &cats {
                by_cat.entry(c).or_default().push(l.text.clone());
            }
        }
        if section_lines.len() < 400 {
            section_lines.push(json!({ "text": l.text, "categories": cats }));
        }
    }
    flush(&mut sections, &current, &mut section_lines);
    let impacts: Vec<Impact> = by_cat
        .iter()
        .map(|(cat, ls)| {
            let (datasets, action, recommendation) = impact_of(game, cat);
            let mut modules: Vec<&'static str> = datasets.iter().flat_map(|d| super::registry::consumers(d)).collect();
            modules.sort();
            modules.dedup();
            let specific = RULES.iter().find(|r| r.category == *cat).is_some_and(|r| r.specific);
            Impact {
                category: cat,
                lines: ls.len(),
                datasets,
                modules,
                action,
                recommendation,
                confidence: if game.is_none() { "unverified" } else if specific { "high" } else { "review" },
                examples: ls.iter().take(3).cloned().collect(),
            }
        })
        .collect();
    json!({
        "classifier": CLASSIFIER,
        "patch": patch_version(title),
        "totalLines": lines.len(),
        "classifiedLines": classified,
        "sections": sections.into_iter().take(80).collect::<Vec<_>>(),
        "impacts": impacts,
    })
}

/// "3.30.0d Hotfix 3" → "3.30.0d"; "0.5.5h Patch Notes" → "0.5.5h".
pub fn patch_version(title: &str) -> Option<String> {
    title.split_whitespace().find_map(|w| {
        let w = w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.');
        let parts: Vec<&str> = w.split('.').collect();
        (parts.len() >= 2 && parts[0].chars().all(|c| c.is_ascii_digit()) && !parts[0].is_empty() && parts[1].chars().next().is_some_and(|c| c.is_ascii_digit())).then(|| w.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FORUM: &str = r#"<tr><td class="thread"><div class="thread_title"><div class="title">
        <a href="/forum/view-thread/4019056">
            3.30.0d Hotfix 3
        </a></div></div><div class="postBy"><span class="profile-link staff"><a href="/account/view-profile/Adam_GGG-0000">Adam_GGG</a></span><span class="post_date">, Nov 23, 2026, 12:44:19 AM</span></div></td></tr>
        <tr><td class="thread"><div class="title"><a href="/forum/view-thread/4017887">3.30.0c Patch Notes &amp; Fixes</a></div>
        <span class="post_date">, Nov 21, 2026, 3:05:00 PM</span></td></tr>"#;

    const THREAD: &str = r#"<tr class="staff"><td class="content-container"><div class="contentStart"></div>
        <div class="content"><h3>0.5.5h Patch Notes</h3><br><ul>
        <li>Fixed a bug where you could not progress in the Atlas Delirium quest.</li>
        <li>The Divination Card The Doctor now drops in Act 4.</li>
        <li>Increased the damage of Fireball by 10%.</li></ul>
        <strong>Ultimatum Changes</strong><br>Added a new Ultimatum modifier: Razor Dance.<br>Hello&#039;s &quot;quotes&quot;
        </div><div class="signature">sig</div></td></tr><tr><td><div class="contentStart"></div><div class="content">ok</div></td></tr>"#;

    #[test]
    fn parses_forum_lists_with_dates_and_kinds() {
        let d = parse_forum_list(FORUM, GameId::Poe1);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].id, "4019056");
        assert_eq!(d[0].title, "3.30.0d Hotfix 3");
        assert_eq!(d[0].kind, "hotfix");
        assert_eq!(d[0].url, "https://www.pathofexile.com/forum/view-thread/4019056");
        assert_eq!(d[0].published_at, Some(days_from_civil(2026, 11, 23) * 86400 + 44 * 60 + 19));
        assert_eq!(d[1].title, "3.30.0c Patch Notes & Fixes");
        assert_eq!(d[1].kind, "patch_notes");
        assert_eq!(d[1].published_at, Some(days_from_civil(2026, 11, 21) * 86400 + 15 * 3600 + 300));
        assert!(parse_forum_list("<html>changed layout</html>", GameId::Poe1).is_empty());
    }

    #[test]
    fn parses_rss_items() {
        let xml = r#"<rss><channel><title>Path of Exile News</title><item><title>Path of Exile 2: 0.5.5 Patch Notes</title>
            <link>https://www.pathofexile.com/forum/view-thread/4016665</link><pubDate>Wed, 18 Nov 2026 03:11:12 +0000</pubDate></item>
            <item><title>Improvements to Core Item Drops</title><link>https://www.pathofexile.com/forum/view-thread/4016748</link></item>
            <item><title>Evil</title><link>https://evil.example.com/x</link></item></channel></rss>"#;
        let d = parse_rss(xml);
        assert_eq!(d.len(), 2, "foreign links are dropped");
        assert_eq!((d[0].game, d[0].kind, d[0].id.as_str()), (Some(GameId::Poe2), "patch_notes", "4016665"));
        assert_eq!(d[0].published_at, Some(days_from_civil(2026, 11, 18) * 86400 + 3 * 3600 + 11 * 60 + 12));
        assert_eq!((d[1].game, d[1].kind), (None, "news"));
    }

    #[test]
    fn extracts_first_post_lines_and_headings() {
        let lines = first_post_lines(THREAD).unwrap();
        assert_eq!(lines[0], Line { text: "0.5.5h Patch Notes".into(), heading: true });
        assert!(lines.iter().any(|l| l.text == "Ultimatum Changes" && l.heading));
        assert!(lines.iter().any(|l| l.text == "Hello's \"quotes\""));
        assert!(!lines.iter().any(|l| l.text == "ok" || l.text == "sig"), "only the first post");
        assert!(first_post_lines("<html></html>").is_none());
    }

    #[test]
    fn classifies_lines_and_maps_impacts_to_registered_modules() {
        let lines = first_post_lines(THREAD).unwrap();
        let a = analyze(Some(GameId::Poe1), "3.30.0d Patch Notes", &lines);
        let impacts = a["impacts"].as_array().unwrap();
        let find = |c: &str| impacts.iter().find(|i| i["category"] == c).cloned();
        let div = find("divination").unwrap();
        assert_eq!(div["action"], "data");
        assert_eq!(div["modules"], json!(["deck-intelligence"]));
        assert_eq!(div["confidence"], "high");
        let ult = find("ultimatum").unwrap();
        assert_eq!(ult["action"], "developer");
        assert_eq!(ult["modules"], json!(["ultimatum-checker"]));
        assert_eq!(find("balance").unwrap()["action"], "info");
        assert_eq!(a["patch"], "3.30.0d");
        // The same text for PoE 2 must not point at PoE 1 modules.
        let b = analyze(Some(GameId::Poe2), "x", &lines);
        assert!(b["impacts"].as_array().unwrap().iter().all(|i| !i["modules"].as_array().unwrap().iter().any(|m| m == "deck-intelligence" || m == "ultimatum-checker")));
        // Unknown game → unverified.
        let c = analyze(None, "x", &lines);
        assert!(c["impacts"].as_array().unwrap().iter().all(|i| i["confidence"] == "unverified"));
    }

    #[test]
    fn decodes_entities_and_versions() {
        assert_eq!(decode_entities("a &amp; b &#x2F; &#039;c&#39; &bogus; &"), "a & b / 'c' &bogus; &");
        assert_eq!(patch_version("0.5.5h Patch Notes").as_deref(), Some("0.5.5h"));
        assert_eq!(patch_version("Covens of Umbra Launches Soon"), None);
        assert_eq!(parse_forum_date("Nov 23, 2026, 12:10:00 PM"), Some(days_from_civil(2026, 11, 23) * 86400 + 12 * 3600 + 600));
        assert_eq!(parse_rfc2822("Wed, 18 Nov 2026 05:11:12 +0200"), Some(days_from_civil(2026, 11, 18) * 86400 + 3 * 3600 + 11 * 60 + 12));
    }

    #[test]
    fn mercenary_lines_flag_the_mercenary_catalog() {
        // Real 3.30.0 patch-note wording (shortened).
        assert!(categorize("Hired Mercenaries now have lower Attack Damage scaling at high levels.").contains(&"mercenaries"));
        assert!(categorize("Mercenary Warrants now open portals to the Proving Grounds.").contains(&"mercenaries"));
        let (datasets, who, _) = impact_of(Some(GameId::Poe1), "mercenaries");
        assert_eq!(datasets, vec!["poe1.mercenary-catalog"]);
        assert_eq!(who, "developer");
    }
}
