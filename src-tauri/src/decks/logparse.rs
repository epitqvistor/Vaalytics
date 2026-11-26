//! The one Client.txt line Deck Intelligence reads (PoE 1), verified on a real log (2026-11-26,
//! 400+ lines between 2025-11 and 2026-11):
//!
//! ```text
//! 2026/11/25 15:04:02 10325187 cffb06be [INFO Client 12060] : Card drawn from the deck: <divination>{The Lover}
//! ```
//!
//! Only system messages count (`] : ` — empty sender). A chat line always has a sender or channel
//! prefix, so somebody typing the same text in chat can't add a card. Everything else in the log is
//! ignored and never stored. Timestamps use the shared `session::log_format::parse_stamp`.

use crate::session::log_format::{parse_stamp, LocalStamp};

const MARK: &str = "Card drawn from the deck: <divination>{";

/// (local time, card name) for a "Card drawn from the deck" system line.
pub fn card_drawn(line: &str) -> Option<(LocalStamp, String)> {
    let line = line.trim_end_matches(['\r', '\n']);
    if !line.contains(MARK) {
        return None; // fast path: almost every line
    }
    let at = parse_stamp(line)?;
    let rest = &line[19..];
    let open = rest.find('[')?;
    let close = open + rest[open..].find(']')?;
    let header = &rest[open + 1..close];
    if header.split(' ').nth(1) != Some("Client") {
        return None;
    }
    let msg = rest[close + 1..].strip_prefix(" : ")?;
    let name = msg.strip_prefix(MARK)?.strip_suffix('}')?;
    let name = name.trim();
    (!name.is_empty() && name.len() <= 80 && !name.contains(['{', '}', '<', '>'])).then(|| (at, name.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_line() {
        let (at, name) = card_drawn("2026/11/25 15:04:02 10325187 cffb06be [INFO Client 12060] : Card drawn from the deck: <divination>{The Lover}\r").unwrap();
        assert_eq!(name, "The Lover");
        assert_eq!((at.year, at.month, at.day, at.hour, at.minute, at.second), (2026, 11, 25, 15, 4, 2));
        let (_, n) = card_drawn("2025/11/04 23:52:27 9325765 cff945bb [INFO Client 24692] : Card drawn from the deck: <divination>{Guardian's Challenge}").unwrap();
        assert_eq!(n, "Guardian's Challenge");
    }

    #[test]
    fn ignores_chat_and_other_lines() {
        // Chat: a sender before the colon.
        assert!(card_drawn("2026/11/25 15:04:02 1 a [INFO Client 1] #Someone: Card drawn from the deck: <divination>{The Doctor}").is_none());
        assert!(card_drawn("2026/11/25 15:04:02 1 a [INFO Client 1] @From X: ] : Card drawn from the deck: <divination>{The Doctor}").is_none());
        assert!(card_drawn("2026/11/25 15:04:02 1 a [INFO Client 1] : You have entered Lioneye's Watch.").is_none());
        assert!(card_drawn("garbage Card drawn from the deck: <divination>{X}").is_none());
        assert!(card_drawn("2026/11/25 15:04:02 1 a [INFO Client 1] : Card drawn from the deck: <divination>{}").is_none());
    }
}
