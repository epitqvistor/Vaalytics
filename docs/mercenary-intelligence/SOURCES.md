# Sources

Checked 2026-11-26 unless noted. Reliability: **official** (GGG), **structured** (game-data export or
API), **tool** (third-party software/heuristics), **opinion** (community). Web content is treated as
untrusted data: nothing from these pages is executed, only facts are kept, every page is linked.

| Source | What it gave | Reliability | Status / notes |
|---|---|---|---|
| Official Trade API — `/api/trade/data/stats` | 539 mercenary stat ids (273 skill, 266 support tier) | official, structured | Fetched live; byte-identical to PoEMercPricer's bundled 3.30 copy. Used to validate every query at run time. |
| Official Trade API — `/api/trade/data/items` | 65 warrant types (`disc: mercenary_warrant`) | official, structured | Fetched live. |
| Official Trade API — `/api/trade/data/leagues` | `Covens`, `Hardcore Covens`, `Ruthless Covens`, `HC Ruthless Covens`, Standard… | official | Fetched live. |
| Official Trade API — search/fetch (Covens) | listing JSON (`mercenarySkills` with stat hashes, `extended.text` = in-game Ctrl+C text), totals, complexity, rate-limit headers | official | ~75 searches on 2026-11-26 (one 429 during fixture collection, see MARKET_METHODOLOGY). |
| [3.30.0 patch notes](https://www.pathofexile.com/forum/view-thread/4013680) (2026-11-11) and 13 hotfix threads to 3.30.0d Hotfix 3 | Mercenary balance changes, Proving Grounds; hotfixes contain no mercenary changes | official | Read via research agent; short facts only. |
| [PoEDB Mercenaries](https://poedb.tw/us/Mercenaries) + 66 build pages | houses (tribes), class attributes, weapons, Primary/Secondary/Utility pools, support count class, every support tier per skill | structured (game files), CC BY-NC-SA 3.0 | Generator: `scripts/poe1-mercenary-catalog.mjs` (1.5 s between pages, User-Agent, robots.txt allows). Facts only; attributed here and in the catalog meta. |
| [PoEDB Mercenary Warrant](https://poedb.tw/us/Mercenary_Warrant) | 3.30 item lines (`Limit`, `Portal`, `Area Level: 83`) | structured | Lines not present in real Ctrl+C copies; parser ignores them wherever they appear. |
| [MagicFind mercenary database](https://magicfind.gg/poe1/database/mercenaries) | 37 builds, houses (Azadi 11, Bardiya 2, Cyaxan 11, Keita 13), pools; Kineticist and Manyshot pools match PoEDB exactly | structured (site) | "Covens · 3.30". No supports per skill shown; no structured feed found. Cross-check only. |
| [PoEMercPricer](https://github.com/Lisood/PoEMercPricer) (MIT, pushed 2026-11-24) | methodology (top-share, sample rules), 3.30 market survey (2026-11-18, day 5), warrant layout notes, anonymous group limit claim, warrant type map | tool | Docs, src, tests read (research-3.30, market-3.30, formulas, performance, ui-design, 3.29 docs, scoring, trade, parse). No code copied; its scores and snapshot are heuristics/asks, not live prices. Attributed. One error found (see CATALOG_AUDIT). |
| [poe.run mercenary](https://poe.run/en/poe1/mercenary) | paste → trade search flow, multi-language claim | tool | 3.30. No data used. |
| [PoEden mercenaries](https://poeden.com/marketplace/mercenaries) | "link skills to their supports, then open the exact Warrant search" | tool | **Outdated**: loads a "local 3.29 mercenary catalog". Not used. |
| [PoE Market Analytics — warrants](https://xddbsns.com/mercenary-warrant.html) and [price check](https://xddbsns.com/mercenary-price-check.html) | method: cheapest exact skill set, unordered pairs, Infamous pooled, thin sets dropped, asks ≠ sales, data ~10 min behind, Faustus Merchant Tab listings, 83/84 pooled | tool | Data is JS-rendered; no numbers could be read. Methodology only. |
| [aoeah 3.29 tier list](https://www.aoeah.com/news/4710--poe-329-best-mercenary-tier-list-locations--how-to-farm) (2026-07-27) | community views (Kinetic Bolt bad, Icicle Rain bad, Brutality on elemental mercs bad) | opinion, **outdated** (3.29) | Labelled opinion; Brutality claim obsolete after 3.30. |
| Guides: mmoso (2026-11-13), vhpg (2026-11-23), timesaver.gg (3.29) | how warrants are obtained, Infamous gear, no Trarthan scarabs in 3.30 | opinion/guide | Context only. |
| Reddit / forum | — | opinion | Could not be fetched (blocked) and search returned no threads. Gap recorded. |
| [Awakened PoE Trade releases](https://github.com/SnosMe/awakened-poe-trade/releases) | warrant support since 3.29.106, "Allow 1 Missing", API-cost optimisation | tool | Confirms other tools search warrants via Trade; no data used. |
| poewiki.net | — | — | Blocked automated access (Anubis). Not used. |
