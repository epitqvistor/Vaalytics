//! Game identity. Every game-scoped piece of data (settings, market data, caches,
//! price history) is keyed by `GameId`. PoE 1 and PoE 2 never share rows.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameId {
    Poe1,
    Poe2,
}

impl GameId {
    #[cfg_attr(not(test), allow(dead_code))]
    pub const ALL: [GameId; 2] = [GameId::Poe1, GameId::Poe2];

    pub fn as_str(self) -> &'static str {
        match self {
            GameId::Poe1 => "poe1",
            GameId::Poe2 => "poe2",
        }
    }
}

impl fmt::Display for GameId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for GameId {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "poe1" => Ok(GameId::Poe1),
            "poe2" => Ok(GameId::Poe2),
            other => Err(format!("unknown game id: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_string_and_json() {
        for g in GameId::ALL {
            assert_eq!(g.as_str().parse::<GameId>().unwrap(), g);
            let json = serde_json::to_string(&g).unwrap();
            assert_eq!(json, format!("\"{}\"", g.as_str()));
            assert_eq!(serde_json::from_str::<GameId>(&json).unwrap(), g);
        }
        assert!("poe3".parse::<GameId>().is_err());
    }
}
