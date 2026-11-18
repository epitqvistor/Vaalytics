//! Read-only incremental reader for a growing log file.
//!
//! - Opens the file only for the duration of a read (Rust's default share mode
//!   lets the game keep writing, renaming or deleting it).
//! - Returns complete lines only; a partial last line is re-read next time, so
//!   the persisted offset always sits on a line boundary (no duplicates, no
//!   half lines).
//! - Detects truncation (size < offset) and replacement (different identity:
//!   creation time + fingerprint of the first bytes) and restarts at 0.
//! - Decodes lossily (invalid UTF-8 never stops reading).

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// Bytes hashed to identify a file. A PoE log starts with
/// `YYYY/MM/DD HH:MM:SS ***** LOG FILE OPENING *****`, unique per file.
const FINGERPRINT_BYTES: usize = 48;
/// Lines longer than this are skipped (counted as parse errors).
pub const MAX_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Probe {
    pub size: u64,
    /// `None` while the file is shorter than the fingerprint.
    pub key: Option<String>,
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn probe(path: &Path) -> io::Result<Probe> {
    let mut f = File::open(path)?;
    let meta = f.metadata()?;
    if !meta.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"));
    }
    let mut head = [0u8; FINGERPRINT_BYTES];
    let mut n = 0;
    while n < FINGERPRINT_BYTES {
        let r = f.read(&mut head[n..])?;
        if r == 0 {
            break;
        }
        n += r;
    }
    let created = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = (n == FINGERPRINT_BYTES).then(|| format!("{created:x}-{:016x}", fnv1a(&head)));
    Ok(Probe { size: meta.len(), key })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reset {
    Truncated,
    Replaced,
}

#[derive(Debug, Default)]
pub struct Chunk {
    /// (byte offset of the line start, decoded line without the line ending)
    pub lines: Vec<(u64, String)>,
    /// Offset after the last complete line read.
    pub offset: u64,
    pub key: Option<String>,
    pub size: u64,
    pub reset: Option<Reset>,
    /// Bytes still unread after this chunk.
    pub remaining: u64,
    pub skipped_long_lines: u32,
}

/// Reads complete lines after `offset`, at most `max_bytes` per call.
pub fn read_from(path: &Path, prev_key: Option<&str>, offset: u64, max_bytes: usize) -> io::Result<Chunk> {
    let p = probe(path)?;
    let mut offset = offset;
    let mut reset = None;
    if let (Some(prev), Some(cur)) = (prev_key, p.key.as_deref()) {
        if prev != cur {
            reset = Some(Reset::Replaced);
            offset = 0;
        }
    }
    if p.size < offset {
        reset = Some(Reset::Truncated);
        offset = 0;
    }
    let mut chunk = Chunk { offset, key: p.key.clone(), size: p.size, reset, ..Default::default() };
    if p.size == offset {
        return Ok(chunk);
    }
    let want = ((p.size - offset) as usize).min(max_bytes.max(MAX_LINE_BYTES));
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; want];
    let mut n = 0;
    while n < want {
        let r = f.read(&mut buf[n..])?;
        if r == 0 {
            break;
        }
        n += r;
    }
    buf.truncate(n);
    let mut start = 0usize;
    for (i, b) in buf.iter().enumerate() {
        if *b != b'\n' {
            continue;
        }
        let raw = &buf[start..i];
        if raw.len() > MAX_LINE_BYTES {
            chunk.skipped_long_lines += 1;
        } else {
            let line = String::from_utf8_lossy(raw);
            chunk.lines.push((offset + start as u64, line.trim_end_matches('\r').to_string()));
        }
        start = i + 1;
    }
    if start == 0 && n >= MAX_LINE_BYTES {
        // One enormous line without a newline: skip what we read so reading can't stall.
        chunk.skipped_long_lines += 1;
        start = n;
    }
    chunk.offset = offset + start as u64;
    chunk.remaining = p.size.saturating_sub(chunk.offset);
    Ok(chunk)
}

/// Offset of the last `LOG FILE OPENING` line within the last `window` bytes,
/// with its raw line, or `None`. Used to start reading at the beginning of the
/// current client run instead of replaying a multi-GB history.
pub fn last_client_start(path: &Path, window: u64) -> io::Result<Option<(u64, String)>> {
    const MARKER: &[u8] = b"***** LOG FILE OPENING *****";
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let from = size.saturating_sub(window);
    f.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::with_capacity((size - from) as usize);
    f.take(size - from).read_to_end(&mut buf)?;
    let Some(pos) = buf.windows(MARKER.len()).rposition(|w| w == MARKER) else { return Ok(None) };
    let line_start = buf[..pos].iter().rposition(|b| *b == b'\n').map(|i| i + 1).unwrap_or(0);
    if line_start == 0 && from > 0 {
        return Ok(None); // the line started before the window
    }
    let line_end = buf[pos..].iter().position(|b| *b == b'\n').map(|i| pos + i).unwrap_or(buf.len());
    let line = String::from_utf8_lossy(&buf[line_start..line_end]).trim_end_matches('\r').to_string();
    Ok(Some((from + line_start as u64, line)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const HEAD: &str = "2026/11/17 14:07:45 ***** LOG FILE OPENING *****\n";

    fn write(path: &Path, s: &str, append: bool) {
        let mut f = std::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(path).unwrap();
        f.write_all(s.as_bytes()).unwrap();
    }

    #[test]
    fn reads_incrementally_without_duplicates_and_waits_for_partial_lines() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        write(&p, &format!("{HEAD}line a\r\nline b\npart"), false);
        let c = read_from(&p, None, 0, 1 << 20).unwrap();
        assert_eq!(c.lines.iter().map(|l| l.1.as_str()).collect::<Vec<_>>(), vec![HEAD.trim_end(), "line a", "line b"]);
        assert_eq!(c.lines[1].0, HEAD.len() as u64);
        assert!(c.key.is_some());
        let again = read_from(&p, c.key.as_deref(), c.offset, 1 << 20).unwrap();
        assert!(again.lines.is_empty(), "partial line not returned yet");
        write(&p, "ial\nnext\n", true);
        let more = read_from(&p, c.key.as_deref(), c.offset, 1 << 20).unwrap();
        assert_eq!(more.lines.iter().map(|l| l.1.as_str()).collect::<Vec<_>>(), vec!["partial", "next"]);
        assert_eq!(more.reset, None);
        assert_eq!(more.remaining, 0);
    }

    #[test]
    fn respects_max_bytes_and_reports_remaining() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        let body: String = (0..5000).map(|i| format!("line {i}\n")).collect();
        write(&p, &format!("{HEAD}{body}"), false);
        let mut off = 0;
        let mut key = None;
        let mut n = 0;
        loop {
            let c = read_from(&p, key.as_deref(), off, MAX_LINE_BYTES).unwrap();
            n += c.lines.len();
            off = c.offset;
            key = c.key;
            if c.remaining == 0 {
                break;
            }
        }
        assert_eq!(n, 5001);
    }

    #[test]
    fn detects_truncation_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        write(&p, &format!("{HEAD}a\nb\nc\n"), false);
        let c = read_from(&p, None, 0, 1 << 20).unwrap();
        // Truncated to a shorter file with the same head.
        write(&p, HEAD, false);
        let t = read_from(&p, c.key.as_deref(), c.offset, 1 << 20).unwrap();
        assert_eq!(t.reset, Some(Reset::Truncated));
        assert_eq!(t.lines.len(), 1);
        // Replaced by a different log (different first line), even if longer.
        write(&p, "2026/11/18 09:00:00 ***** LOG FILE OPENING *****\nx\ny\nz\nw\nv\n", false);
        let r = read_from(&p, t.key.as_deref(), t.offset, 1 << 20).unwrap();
        assert_eq!(r.reset, Some(Reset::Replaced));
        assert_eq!(r.lines.len(), 6);
    }

    #[test]
    fn missing_file_is_an_error_and_invalid_utf8_is_lossy() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        assert!(read_from(&p, None, 0, 1024).is_err());
        let mut bytes = HEAD.as_bytes().to_vec();
        bytes.extend_from_slice(b"bad \xff\xfe bytes\n");
        std::fs::write(&p, bytes).unwrap();
        let c = read_from(&p, None, 0, 1 << 20).unwrap();
        assert_eq!(c.lines[1].1, "bad \u{FFFD}\u{FFFD} bytes");
    }

    #[test]
    fn skips_overlong_lines() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        write(&p, &format!("{HEAD}{}\nok\n", "x".repeat(MAX_LINE_BYTES + 10)), false);
        let mut off = 0;
        let mut lines = vec![];
        let mut skipped = 0;
        for _ in 0..5 {
            let c = read_from(&p, None, off, MAX_LINE_BYTES).unwrap();
            lines.extend(c.lines.into_iter().map(|l| l.1));
            skipped += c.skipped_long_lines;
            off = c.offset;
        }
        assert!(lines.contains(&"ok".to_string()));
        assert!(skipped >= 1);
    }

    #[test]
    fn finds_the_last_client_start() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Client.txt");
        let second = "2026/11/17 20:00:00 ***** LOG FILE OPENING *****\n";
        write(&p, &format!("{HEAD}a\nb\n{second}c\n"), false);
        let (off, line) = last_client_start(&p, 1 << 20).unwrap().unwrap();
        assert_eq!(off, (HEAD.len() + 4) as u64);
        assert_eq!(line, second.trim_end());
        write(&p, "no marker\n", false);
        assert_eq!(last_client_start(&p, 1 << 20).unwrap(), None);
    }
}
