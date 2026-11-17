//! Client-side enforcement of GGG's trade rate limits.
//!
//! The server describes its limits on every response:
//!   X-Rate-Limit-Policy: trade-search-request-limit
//!   X-Rate-Limit-Rules:  Ip
//!   X-Rate-Limit-Ip:       5:10:60,15:60:300,…   (max hits : window s : penalty s)
//!   X-Rate-Limit-Ip-State: 1:10:0,1:60:0,…       (hits in window : window s : active penalty s)
//!
//! Each window is tracked independently:
//! - our own request timestamps (exact, per window), and
//! - the server's reported count for that window at the time of the response
//!   (catches other tools/browser tabs sharing the IP).
//!
//! Earlier versions copied a long window's count (e.g. 8 hits in 6 h) into the
//! shared timestamp history as "now", which made short windows (5 per 10 s)
//! look full after a single search. Server counts are now kept per window.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rule {
    pub max_hits: u32,
    pub period: Duration,
    pub penalty: Duration,
}

#[derive(Debug, Clone, Copy)]
struct Window {
    rule: Rule,
    /// Hits the server reported for this window, and when.
    server: Option<(u32, Instant)>,
}

#[derive(Debug, Default)]
struct PolicyState {
    windows: Vec<Window>,
    history: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

/// Known policies, used before the first response reveals the real ones.
pub fn default_rules(policy: &str) -> Vec<Rule> {
    let r = |h, p, x| Rule { max_hits: h, period: Duration::from_secs(p), penalty: Duration::from_secs(x) };
    match policy {
        // Observed 2026-11-16.
        "trade-search-request-limit" => vec![r(5, 10, 60), r(15, 60, 300), r(30, 300, 1800), r(600, 21600, 3600)],
        "trade-fetch-request-limit" => vec![r(12, 4, 10), r(16, 12, 300), r(50, 300, 300), r(1000, 21600, 1800)],
        _ => vec![r(3, 10, 60)],
    }
}

pub fn parse_rules(value: &str) -> Vec<Rule> {
    value
        .split(',')
        .filter_map(|part| {
            let mut it = part.trim().split(':').map(|n| n.parse::<u64>().ok());
            let (Some(Some(h)), Some(Some(p)), Some(Some(x))) = (it.next(), it.next(), it.next()) else { return None };
            Some(Rule { max_hits: h as u32, period: Duration::from_secs(p), penalty: Duration::from_secs(x) })
        })
        .collect()
}

/// Keep one request in reserve on small windows (other tools may share the IP);
/// large windows get a proportional reserve.
fn usable(max_hits: u32) -> u32 {
    let reserve = (max_hits / 20).max(1);
    max_hits.saturating_sub(reserve).max(1)
}

#[derive(Default)]
pub struct RateLimiter {
    policies: std::collections::HashMap<String, PolicyState>,
}

impl RateLimiter {
    fn policy(&mut self, name: &str) -> &mut PolicyState {
        self.policies.entry(name.to_owned()).or_insert_with(|| PolicyState {
            windows: default_rules(name).into_iter().map(|rule| Window { rule, server: None }).collect(),
            ..Default::default()
        })
    }

    /// Time to wait before a request under `policy` may be sent (zero = go now).
    pub fn wait_time(&mut self, policy: &str, now: Instant) -> Duration {
        let st = self.policy(policy);
        let longest = st.windows.iter().map(|w| w.rule.period).max().unwrap_or_default();
        while st.history.front().is_some_and(|t| now.duration_since(*t) >= longest) {
            st.history.pop_front();
        }

        let mut wait = st.blocked_until.map(|b| b.saturating_duration_since(now)).unwrap_or_default();
        for w in &st.windows {
            let limit = usable(w.rule.max_hits) as usize;

            // 1) Our own requests inside this window (exact expiry times).
            let ours: Vec<Instant> = st.history.iter().copied().filter(|t| now.duration_since(*t) < w.rule.period).collect();
            if ours.len() >= limit {
                let oldest_needed = ours[ours.len() - limit];
                wait = wait.max((oldest_needed + w.rule.period).saturating_duration_since(now));
            }

            // 2) Server's count for this window + our requests sent since then.
            //    We don't know when those hits expire, so only block when this
            //    window is genuinely full, and at most until the window has passed.
            if let Some((hits, at)) = w.server {
                let age = now.duration_since(at);
                if age < w.rule.period {
                    let since = st.history.iter().filter(|t| **t > at).count();
                    if hits as usize + since >= limit {
                        wait = wait.max(w.rule.period - age);
                    }
                }
            }
        }
        wait
    }

    pub fn record_request(&mut self, policy: &str, at: Instant) {
        self.policy(policy).history.push_back(at);
    }

    /// Applies server-reported rules and per-window state.
    pub fn apply_headers(&mut self, policy: &str, rules: &str, state: &str, now: Instant) {
        let rules = parse_rules(rules);
        let state = parse_rules(state);
        let st = self.policy(policy);
        if !rules.is_empty() {
            st.windows = rules.iter().map(|&rule| Window { rule, server: None }).collect();
        }
        for current in &state {
            if current.penalty > Duration::ZERO {
                // Server says we are restricted right now.
                let until = now + current.penalty;
                st.blocked_until = Some(st.blocked_until.map_or(until, |b| b.max(until)));
            }
            // Match by window length, not position.
            if let Some(w) = st.windows.iter_mut().find(|w| w.rule.period == current.period) {
                w.server = Some((current.max_hits, now));
            }
        }
    }

    pub fn block_for(&mut self, policy: &str, d: Duration, now: Instant) {
        let st = self.policy(policy);
        let until = now + d;
        st.blocked_until = Some(st.blocked_until.map_or(until, |b| b.max(until)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH: &str = "trade-search-request-limit";
    const SEARCH_RULES: &str = "5:10:60,15:60:300,30:300:1800,600:21600:3600";

    #[test]
    fn parses_rule_headers() {
        assert_eq!(
            parse_rules("5:10:60,15:60:300"),
            vec![
                Rule { max_hits: 5, period: Duration::from_secs(10), penalty: Duration::from_secs(60) },
                Rule { max_hits: 15, period: Duration::from_secs(60), penalty: Duration::from_secs(300) },
            ]
        );
        assert!(parse_rules("garbage").is_empty());
    }

    /// Regression: the reported bug. A long-window count (e.g. 40 searches in
    /// the last 6 h) must not block the next search.
    #[test]
    fn long_window_history_does_not_block_short_windows() {
        let mut rl = RateLimiter::default();
        let t0 = Instant::now();
        rl.record_request(SEARCH, t0);
        rl.apply_headers(SEARCH, SEARCH_RULES, "1:10:0,1:60:0,2:300:0,40:21600:0", t0);
        assert_eq!(rl.wait_time(SEARCH, t0 + Duration::from_millis(500)), Duration::ZERO);
        // and a normal session of searches spaced a few seconds apart keeps working
        let mut t = t0;
        for i in 2..=4 {
            t += Duration::from_secs(3);
            assert_eq!(rl.wait_time(SEARCH, t), Duration::ZERO, "search {i}");
            rl.record_request(SEARCH, t);
            rl.apply_headers(SEARCH, SEARCH_RULES, &format!("{i}:10:0,{i}:60:0,{}:300:0,{}:21600:0", i + 1, 40 + i), t);
        }
    }

    #[test]
    fn blocks_before_exceeding_a_short_window() {
        let mut rl = RateLimiter::default();
        let t0 = Instant::now();
        // 5 per 10 s with a reserve of 1 → 4 allowed
        for i in 0..4 {
            assert_eq!(rl.wait_time(SEARCH, t0), Duration::ZERO, "request {i}");
            rl.record_request(SEARCH, t0);
        }
        let w = rl.wait_time(SEARCH, t0);
        assert!(w > Duration::from_secs(9) && w <= Duration::from_secs(10), "{w:?}");
        assert_eq!(rl.wait_time(SEARCH, t0 + Duration::from_secs(10)), Duration::ZERO);
    }

    #[test]
    fn server_count_from_other_tools_is_respected() {
        let mut rl = RateLimiter::default();
        let t0 = Instant::now();
        // Another tool on this IP already used 4 of 5 searches in the 10 s window.
        rl.apply_headers(SEARCH, SEARCH_RULES, "4:10:0,4:60:0,4:300:0,4:21600:0", t0);
        let w = rl.wait_time(SEARCH, t0);
        assert!(w > Duration::ZERO && w <= Duration::from_secs(10), "{w:?}");
        // …and that view expires with the window.
        assert_eq!(rl.wait_time(SEARCH, t0 + Duration::from_secs(10)), Duration::ZERO);
    }

    #[test]
    fn active_penalty_blocks() {
        let mut rl = RateLimiter::default();
        let t0 = Instant::now();
        rl.apply_headers(SEARCH, SEARCH_RULES, "6:10:60,6:60:0,6:300:0,6:21600:0", t0);
        assert!(rl.wait_time(SEARCH, t0) >= Duration::from_secs(59));
    }

    #[test]
    fn policies_are_independent() {
        let mut rl = RateLimiter::default();
        let t0 = Instant::now();
        for _ in 0..4 {
            rl.record_request(SEARCH, t0);
        }
        assert_eq!(rl.wait_time("trade-fetch-request-limit", t0), Duration::ZERO);
    }

    #[test]
    fn reserve_scales_with_window_size() {
        assert_eq!(usable(5), 4);
        assert_eq!(usable(12), 11);
        assert_eq!(usable(600), 570);
        assert_eq!(usable(1), 1);
    }
}
