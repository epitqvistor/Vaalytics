//! Parser for the Path of Exile 2 `Client.txt` log.
//!
//! Only line shapes verified against a real PoE 2 client log (0.5.x, build
//! 328873) are recognised — see docs/modules/session-intelligence.md for the
//! sanitized samples. Everything else is ignored (not an error): the log holds
//! hundreds of engine/render/chat line types we have no use for.
//!
//! Verified shapes:
//! ```text
//! 2026/11/17 14:07:45 ***** LOG FILE OPENING *****
//! 2026/11/17 14:15:49 9562875 2caa22f9 [DEBUG Client 50980] Generating level 79 area "MapRazedFields" with seed 3682517103
//! 2026/11/17 14:15:50 9563296 7fbd1225 [INFO Client 50980] [SCENE] Set Source [Razed Fields]
//! 2026/11/17 14:15:53 9566765 4cba6a95 [INFO Client 50980] [LOADING SCREEN] (Razed Fields) Duration = 4.00466 seconds
//! 2026/11/17 14:16:38 9611406 3ef23348 [INFO Client 50980] : SomeName has been slain.
//! ... [INFO Client 1234] : SomeName (Some Class) is now level 92
//! ... [INFO Client 1234] : AFK mode is now ON. Autoreply "This player is AFK."
//! ... [INFO Client 1234] : AFK mode is now OFF.
//! ... [INFO Client 1234] Abnormal disconnect: An unexpected disconnection occurred.
//! ... [INFO Client 1234] [HTTP2] User agent: PoE poe2_production/tags/0.5.5g Windows x64
//! ... [INFO Client 1234] Async connecting to mil.login.pathofexile2.com:21270
//! ... [INFO Client 1234] : You have received 2 Passive Skill Points.
//! ... [INFO Client 1234] : You have received 2 Weapon Set Passive Skill Points.
//! ... [INFO Client 1234] : SomeName has joined the area.
//! ... [INFO Client 1234] : SomeName has left the area.
//! ```
//! The last six shapes are used by Campaign Intelligence (docs/modules/campaign-intelligence.md).
//! System messages are `] : text` (empty sender); chat always has a sender or a
//! channel prefix, so a chat line can't be mistaken for a system message.

/// Wall-clock time as written in the log (local time, no zone).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalStamp {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LogEvent {
    /// The client started writing a new run to the log.
    ClientStart,
    /// The client generated (entered) an area instance. Re-entering the same
    /// instance logs the same seed again.
    AreaGenerated { level: u32, area_id: String, seed: u64 },
    /// Display name of the current scene (`(null)`/`(unknown)` are filtered out).
    SceneName(String),
    LoadingScreen { name: String, secs: f64 },
    /// A character was slain. The log names the character but doesn't say
    /// whether it is the player or a party member.
    Slain { name: String },
    /// A character reached a level (player or party member — same caveat).
    /// `class` is the base class or, after ascending, the Ascendancy.
    LevelUp { level: u32, name: String, class: String },
    /// `poe2_production/tags/<tag>` from the client's User-Agent line.
    ClientVersion { tag: String },
    /// The client connects to the login server: the player logged in or went
    /// back to character selection, so the active character may change.
    LoginConnect,
    /// "You have received N (Weapon Set) Passive Skill Points." — a quest
    /// reward was applied. The two variants are logged together.
    PassivePoints { amount: u32, weapon_set: bool },
    /// Another player entered / left the area (never the local player).
    PlayerJoined { name: String },
    PlayerLeft { name: String },
    AfkOn,
    AfkOff,
    AbnormalDisconnect,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLine {
    pub at: LocalStamp,
    /// The number in `[INFO Client 50980]` — the client's process id.
    pub client_id: Option<u32>,
    pub event: LogEvent,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LineResult {
    Event(ParsedLine),
    /// A well-formed log line we don't track.
    Ignored,
    /// Doesn't look like a log line at all (counted as a parse error).
    Malformed,
}

fn num<T: std::str::FromStr>(s: &str) -> Option<T> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// `YYYY/MM/DD HH:MM:SS` at the start of a line.
pub fn parse_stamp(s: &str) -> Option<LocalStamp> {
    let b = s.as_bytes();
    if b.len() < 19 || !b[..19].is_ascii() || b[4] != b'/' || b[7] != b'/' || b[10] != b' ' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let st = LocalStamp {
        year: num(&s[0..4])?,
        month: num(&s[5..7])?,
        day: num(&s[8..10])?,
        hour: num(&s[11..13])?,
        minute: num(&s[14..16])?,
        second: num(&s[17..19])?,
    };
    let valid = (1..=12).contains(&st.month) && (1..=31).contains(&st.day) && st.hour < 24 && st.minute < 60 && st.second < 61;
    valid.then_some(st)
}

pub fn parse_line(line: &str) -> LineResult {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() {
        return LineResult::Ignored;
    }
    let Some(at) = parse_stamp(line) else { return LineResult::Malformed };
    let rest = &line[19..];
    let rest = rest.strip_prefix(' ').unwrap_or(rest);
    if rest.trim() == "***** LOG FILE OPENING *****" {
        return LineResult::Event(ParsedLine { at, client_id: None, event: LogEvent::ClientStart });
    }
    // `<ms> <hex> [LEVEL Client <pid>] <message>`
    let Some(open) = rest.find('[') else { return LineResult::Ignored };
    let Some(close_rel) = rest[open..].find(']') else { return LineResult::Ignored };
    let header = &rest[open + 1..open + close_rel];
    let mut parts = header.split(' ');
    let (_level, client, pid) = (parts.next(), parts.next(), parts.next());
    if client != Some("Client") {
        return LineResult::Ignored;
    }
    let client_id = pid.and_then(num::<u32>);
    let msg = &rest[open + close_rel + 1..];
    let msg = msg.strip_prefix(' ').unwrap_or(msg);
    match parse_message(msg) {
        Some(event) => LineResult::Event(ParsedLine { at, client_id, event }),
        None => LineResult::Ignored,
    }
}

fn parse_message(msg: &str) -> Option<LogEvent> {
    if let Some(r) = msg.strip_prefix("Generating level ") {
        // `79 area "MapRazedFields" with seed 3682517103`
        let (level, r) = r.split_once(" area \"")?;
        let (area_id, r) = r.split_once('"')?;
        let seed = r.trim().strip_prefix("with seed ")?;
        if area_id.is_empty() || area_id.len() > 128 {
            return None;
        }
        return Some(LogEvent::AreaGenerated { level: num(level)?, area_id: area_id.to_string(), seed: num(seed.trim())? });
    }
    if let Some(r) = msg.strip_prefix("[SCENE] Set Source [") {
        let name = r.strip_suffix(']')?.trim();
        return match name {
            "" | "(null)" | "(unknown)" => None,
            n => Some(LogEvent::SceneName(n.chars().take(120).collect())),
        };
    }
    if let Some(r) = msg.strip_prefix("[LOADING SCREEN] (") {
        let (name, r) = r.split_once(") Duration = ")?;
        let secs: f64 = r.strip_suffix(" seconds")?.trim().parse().ok()?;
        if !secs.is_finite() || secs < 0.0 {
            return None;
        }
        return Some(LogEvent::LoadingScreen { name: name.chars().take(120).collect(), secs });
    }
    if msg.starts_with("Abnormal disconnect:") {
        return Some(LogEvent::AbnormalDisconnect);
    }
    if let Some(r) = msg.strip_prefix("[HTTP2] User agent: PoE poe2_production/tags/") {
        let tag = r.split(' ').next()?;
        let ok = !tag.is_empty() && tag.len() <= 32 && tag.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.');
        return ok.then(|| LogEvent::ClientVersion { tag: tag.to_string() });
    }
    if let Some(r) = msg.strip_prefix("Async connecting to ") {
        let host = r.split(':').next()?;
        return host.ends_with(".login.pathofexile2.com").then_some(LogEvent::LoginConnect);
    }
    let sys = msg.strip_prefix(": ")?;
    if sys == "AFK mode is now OFF." {
        return Some(LogEvent::AfkOff);
    }
    if sys.starts_with("AFK mode is now ON.") {
        return Some(LogEvent::AfkOn);
    }
    if let Some(name) = sys.strip_suffix(" has been slain.") {
        // Character names are a single token.
        return single_token(name).then(|| LogEvent::Slain { name: name.to_string() });
    }
    if let Some(r) = sys.strip_prefix("You have received ") {
        let (amount, kind) = r.split_once(' ')?;
        let amount = if amount == "a" { 1 } else { num(amount)? };
        let weapon_set = match kind {
            "Passive Skill Points." | "Passive Skill Point." => false,
            "Weapon Set Passive Skill Points." | "Weapon Set Passive Skill Point." => true,
            _ => return None,
        };
        return Some(LogEvent::PassivePoints { amount, weapon_set });
    }
    if let Some(name) = sys.strip_suffix(" has joined the area.") {
        return single_token(name).then(|| LogEvent::PlayerJoined { name: name.to_string() });
    }
    if let Some(name) = sys.strip_suffix(" has left the area.") {
        return single_token(name).then(|| LogEvent::PlayerLeft { name: name.to_string() });
    }
    if let Some((head, level)) = sys.rsplit_once(") is now level ") {
        let (name, class) = head.split_once(" (")?;
        if !single_token(name) || class.is_empty() || class.len() > 64 {
            return None;
        }
        return Some(LogEvent::LevelUp { level: num(level.trim())?, name: name.to_string(), class: class.to_string() });
    }
    None
}

/// Character names are one token of bounded length.
fn single_token(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && !name.contains(' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    // Sanitized lines from a real PoE 2 Client.txt (names and IPs replaced).
    const SAMPLE: &str = "\
2026/11/17 14:07:45 ***** LOG FILE OPENING *****
2026/11/17 14:07:45 9078578 a1e2d5d9 [INFO Client 50980] [HTTP2] User agent: PoE poe2_production/tags/0.5.5g Windows x64
2026/11/17 14:08:15 9108250 91c6ce9 [INFO Client 50980] Connecting to instance server at 0.0.0.0:21360
2026/11/17 14:08:15 9108343 2caa22f9 [DEBUG Client 50980] Generating level 65 area \"HideoutShrine\" with seed 1
2026/11/17 14:08:15 9108421 7fbd1225 [INFO Client 50980] [SCENE] Set Source [Shrine Hideout]
2026/11/17 14:08:43 9136109 4cba6a95 [INFO Client 50980] [LOADING SCREEN] (Shrine Hideout) Duration = 27.8642 seconds
2026/11/17 14:15:49 9562875 2caa22f9 [DEBUG Client 50980] Generating level 79 area \"MapRazedFields\" with seed 3682517103
2026/11/17 14:15:50 9563296 7fbd1225 [INFO Client 50980] [SCENE] Set Source [(null)]
2026/11/17 14:15:50 9563296 7fbd1225 [INFO Client 50980] [SCENE] Set Source [Razed Fields]
2026/11/17 14:16:38 9611406 3ef23348 [INFO Client 50980] : Exile_One has been slain.
2026/11/17 14:16:40 9611406 3ef23348 [INFO Client 50980] : Exile_One (Gemling Legionnaire) is now level 92
2026/11/17 14:16:41 9611406 3ef23348 [INFO Client 50980] : AFK mode is now ON. Autoreply \"This player is AFK.\"
2026/11/17 14:16:42 9611406 3ef23348 [INFO Client 50980] : AFK mode is now OFF.
2026/11/17 14:16:43 9611406 3ef23348 [INFO Client 50980] Abnormal disconnect: An unexpected disconnection occurred.
2026/11/17 14:16:44 9611406 3ef23348 [INFO Client 50980] #Someone: Exile_One has been slain.
2026/11/17 14:16:45 9611406 3ef23348 [INFO Client 50980] Someone: : AFK mode is now ON.
2026/11/17 14:20:01 9611406 3ef23348 [INFO Client 50980] Async connecting to mil.login.pathofexile2.com:21270
2026/11/17 14:20:02 9611406 3ef23348 [INFO Client 50980] Connected to mil.login.pathofexile2.com in 32ms.
2026/11/17 14:21:00 9611406 3ef23348 [INFO Client 50980] : You have received 2 Passive Skill Points.
2026/11/17 14:21:00 9611406 3ef23348 [INFO Client 50980] : You have received 2 Weapon Set Passive Skill Points.
2026/11/17 14:21:01 9611406 3ef23348 [INFO Client 50980] : You have received 2 Atlas Skill Points.
2026/11/17 14:21:02 9611406 3ef23348 [INFO Client 50980] : Other_Player has joined the area.
2026/11/17 14:21:03 9611406 3ef23348 [INFO Client 50980] : Other_Player has left the area.
2026/11/17 14:21:04 9611406 3ef23348 [INFO Client 50980] #Someone: You have received 2 Passive Skill Points.
";

    fn events() -> Vec<ParsedLine> {
        SAMPLE
            .lines()
            .filter_map(|l| match parse_line(l) {
                LineResult::Event(e) => Some(e),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn parses_verified_line_shapes() {
        let ev: Vec<LogEvent> = events().into_iter().map(|e| e.event).collect();
        assert_eq!(
            ev,
            vec![
                LogEvent::ClientStart,
                LogEvent::ClientVersion { tag: "0.5.5g".into() },
                LogEvent::AreaGenerated { level: 65, area_id: "HideoutShrine".into(), seed: 1 },
                LogEvent::SceneName("Shrine Hideout".into()),
                LogEvent::LoadingScreen { name: "Shrine Hideout".into(), secs: 27.8642 },
                LogEvent::AreaGenerated { level: 79, area_id: "MapRazedFields".into(), seed: 3682517103 },
                LogEvent::SceneName("Razed Fields".into()),
                LogEvent::Slain { name: "Exile_One".into() },
                LogEvent::LevelUp { level: 92, name: "Exile_One".into(), class: "Gemling Legionnaire".into() },
                LogEvent::AfkOn,
                LogEvent::AfkOff,
                LogEvent::AbnormalDisconnect,
                LogEvent::LoginConnect,
                LogEvent::PassivePoints { amount: 2, weapon_set: false },
                LogEvent::PassivePoints { amount: 2, weapon_set: true },
                LogEvent::PlayerJoined { name: "Other_Player".into() },
                LogEvent::PlayerLeft { name: "Other_Player".into() },
            ]
        );
    }

    #[test]
    fn reads_timestamp_and_client_id() {
        let e = &events()[2];
        assert_eq!(e.at, LocalStamp { year: 2026, month: 11, day: 17, hour: 14, minute: 8, second: 15 });
        assert_eq!(e.client_id, Some(50980));
        assert_eq!(events()[0].client_id, None);
    }

    #[test]
    fn chat_never_counts_as_system_message() {
        // Chat lines quoting system text (slain, AFK, passive points) are never events.
        assert_eq!(events().len(), 17);
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] Async connecting to login.pathofexile.com:20481"), LineResult::Ignored);
    }

    #[test]
    fn invalid_lines_are_malformed_or_ignored() {
        assert_eq!(parse_line("garbage"), LineResult::Malformed);
        assert_eq!(parse_line("2026/13/17 14:07:45 x"), LineResult::Malformed);
        assert_eq!(parse_line(""), LineResult::Ignored);
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] [RENDER] Something"), LineResult::Ignored);
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] Generating level x area \"A\" with seed 1"), LineResult::Ignored);
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] Generating level 5 area \"\" with seed 1"), LineResult::Ignored);
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] [LOADING SCREEN] (X) Duration = NaN seconds"), LineResult::Ignored);
        // Lossy-decoded bytes don't panic.
        assert_eq!(parse_line("2026/11/17 14:07:45 1 a [INFO Client 1] [SCENE] Set Source [\u{FFFD}\u{FFFD}]"), LineResult::Event(ParsedLine {
            at: LocalStamp { year: 2026, month: 11, day: 17, hour: 14, minute: 7, second: 45 },
            client_id: Some(1),
            event: LogEvent::SceneName("\u{FFFD}\u{FFFD}".into()),
        }));
    }

    #[test]
    fn crlf_line_endings_are_accepted() {
        assert!(matches!(parse_line("2026/11/17 14:07:45 ***** LOG FILE OPENING *****\r\n"), LineResult::Event(_)));
    }

    /// Parses a real log: `VAALYTICS_POE2_LOG=<path> cargo test -- --ignored live_client_log --nocapture`.
    #[test]
    #[ignore]
    fn live_client_log() {
        let Ok(path) = std::env::var("VAALYTICS_POE2_LOG") else { return };
        let bytes = std::fs::read(path).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        let (mut events, mut ignored, mut malformed) = (std::collections::BTreeMap::<String, usize>::new(), 0, 0);
        for l in text.lines() {
            match parse_line(l) {
                LineResult::Event(e) => *events.entry(format!("{:?}", e.event).split([' ', '(', '{']).next().unwrap().to_string()).or_default() += 1,
                LineResult::Ignored => ignored += 1,
                LineResult::Malformed => malformed += 1,
            }
        }
        println!("events {events:?}, ignored {ignored}, malformed {malformed}");
        assert!(events.contains_key("AreaGenerated"));
    }
}
