# Redesign „Vaal / Obsidian Instrument” — raport końcowy (etapy A–F)

Data: 2026-11-26 · baza `7048c6b` (0.20.2) · punkt powrotu: lokalny tag `pre-vaal-redesign`.
Audyt: `docs/reports/vaal-redesign-audit-2026-11-26.md` · zasady: `docs/modules/design-system.md`.
Zmiany: 18 commitów, 86 plików, +923 / −643. Nic nie zostało wypchnięte ani wydane; wersja nadal 0.20.2.

## System wizualny (etap B)
- **Tokeny** (`src/styles/index.css`): powierzchnie w pełnych kolorach `#101113 → #232528`, `well #0D0E10`;
  linie jako pełne kolory (`#25272B` / `#33353A`) zamiast bieli z alfą; tekst `#E7E3DB / #A09B91 / #88857D / #4B4A47`;
  brąz `bronze #795536 · copper #A2764B · accent #C08A4E · accent-2 #D0A36D`; stonowana semantyka;
  promienie 2/3/4 (6 dla elementów pływających); cienie tylko pod menu/modalami/tooltipami; `max-w-page` 1560 px;
  `window-close` jako token; skala tekstu + `3xl`.
- **Kontrast** (zmierzony): `fg` ≥ 13:1, `fg-muted` ≥ 6:1, `fg-subtle` ≥ 4.5:1 na `bg`/`surface`/`elevated`
  (podniesiony z 3.6:1 w etapie F), przycisk primary 6.2:1.
- **Powierzchnie**: `panel`, `panel-raised` (brązowy włos u góry), `well`; `glass*` zachowane jako nazwy, ale rysują
  pełne kolory — zero `backdrop-filter`, gradientów i poświat w komponentach.
- **Znaki Vaal (zamknięty zestaw)**: `vaal-lintel` (przed eyebrow strony), `vaal-step` (aktywna nawigacja),
  `vaal-rule` (stopka sidebaru).
- **Komponenty**: Button (bez unoszenia/skalowania, primary pełny brąz), Input/Select/Checkbox/Switch (well, miedziana
  ramka fokusu), SegmentedControl (28/32 px jak reszta kontrolek), Badge/Kbd, Panel (+ `meta`), PageHeader, StatTile +
  nowy `Stat`, NavItem, Modal, EmptyState (bez medalionu), Skeleton. **Nowe**: `Table / Th / Tr / Td / ItemCell`.
- **Motion**: przejścia kolorów 120 ms, wskaźniki 180 ms tween (bez sprężyny), wejście strony 4 px.

## Shell (etap C)
Pasek tytułu 34 px; sidebar 220 px pełny `bg-2`; przełącznik gry 56 px (grafika użytkownika pod scrimem, bez zoomu);
grupy nawigacji zwykłym tekstem; aktywna pozycja = tło + `vaal-step` + ikona w akcencie; „Soon” czytelne;
treść `px-7 pt-5`; tło aplikacji bez światła/rysunku atlasu/ziarna/winiety (`Atmosphere` ustawia tylko `data-game`).

## Dashboard i wykresy (etap D)
Pasek kluczowych cen (`Stat` + `divide-x`, `led-edge` na całym pasku w PoE 2) → wykres premium-waluty z
„Change since …/Low/High” obok watchlisty (tabela) → Gainers / Decliners (po 5, z tego samego `biggestMovers`).
Licznik watchlisty przeniesiony do nagłówka panelu. `AreaChart`: przerywana siatka, oś z podziałką, 2–8 dat
zależnie od szerokości (bez duplikatów), znacznik ostatniej wartości, przerywany celownik, bez animacji rysowania
(test `AreaChart.test.ts`). `BarChart`/`Sparkline` dopasowane.

## Moduły (etap E)
Currency Tracker, Price Checker, Market Intelligence, Update Center, Deck Intelligence, Location Atlas, Campaign
Intelligence, Session Intelligence, Browser, Path of Building & Tools, nakładka Price Check, REGEX, Act Tracker
(+ okno), Crafting, Loot Journal (+ okno). Wspólne: etykiety bez wersalików/rozstrzelenia, wartości `text-[Npx]`
zastąpione skalą, tinty z tokenów, kanciaste paski, liczby w Segoe `tabular` (Cascadia tylko dla kodu/regex/ścieżek).
Naprawiony błąd: REGEX używał nieistniejącej klasy `bg-bg-1` (pola bez tła).
Trade, Builds, Settings, Ultimatum, Loot Intelligence nie wymagały zmian poza tym, co dały tokeny/komponenty.

## QA (etap F) — wykonane
- Prawdziwa aplikacja (dev build, kopia bazy w `VAALYTICS_DATA_DIR`, CDP): Dashboard PoE 1 i PoE 2 w 1280×800,
  1600×900, 1920×1046, 2560×1406 i 1024×680 (bez poziomego przewijania); wszystkie wymienione moduły; okna
  Act Tracker i Loot Tracker; otwarte menu Select; tooltip wykresu; Settings; Diagnostics.
- `npm run check:all`: typecheck OK · Vitest 405 passed / 6 skipped · Rust 216 passed / 19 ignored.
- Diagnostics (debug + CDP, orientacyjnie): host 0.8 % CPU, WebView2 1.6 % CPU po 1 min.

## Nie zweryfikowane / pozostałe
- **Nakładka Price Check w grze** (otwiera się hotkeyem nad grą) — tylko kod, nie oglądana.
- **Ekran wyboru gry** celowo bez zmian (grafika i kafle z 0.20.1): ma jeszcze własne zaokrąglenia 18 px, cienie,
  rozjaśnianie i eyebrow wersalikami — do decyzji użytkownika.
- **`led-edge`** (czerwona poświata PoE 2) bez zmian, czeka na decyzję użytkownika.
- **Karta przedmiotu** (`item-renderer`) zachowuje gradient nagłówka w stylu gry — świadomie.
- **Galeria Design system** (Settings, dev) nie została przepisana pod nowe komponenty (`Table`, `Stat`).
- Tabele w modułach są nadal w większości własnymi gridami (wirtualizacja w Currency Tracker, Library); nowe `Table`
  używa Dashboard. Ujednolicenie reszty to dalsza praca.
- Pomiar wydajności release vs `pre-vaal-redesign` (`scripts/perf-measure.mjs`) nie był robiony.
- Przed wydaniem: podbić wersję (package.json, Cargo.toml, tauri.conf.json), wpis w changelogu, build NSIS.
