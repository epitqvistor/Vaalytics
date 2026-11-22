# Audyt i optymalizacja Vaalytics 0.15.4 → 0.15.5 (2026-11-22/23)

Punkt powrotu: tag `pre-optimization-0.15.4` (= `d46abba`, `origin/main`). Commity: `4b8329a`, `8b7e834`, `f718fad`
(niewypchnięte). Narzędzie pomiarowe: `scripts/perf-measure.mjs` (opis: docs/development/setup.md).

## 1. Podsumowanie

Aplikacja była już w dobrym stanie: usługi w tle są sterowane zdarzeniami/condvarem, listy >100 wierszy w kluczowych
widokach są wirtualizowane, zapytania SQL trafiają w indeksy, profil release jest zoptymalizowany
(`opt-level="s"`, `lto`, `codegen-units=1`, `strip`, `panic="abort"`). Zmiany są więc małe i bezpieczne:
ciężkie komendy odczytu przeniesione z wątku UI, usunięte zbędne re-rendery Atlasu co 2 s, naprawiony wyciek
listenera, tańszy skan procesów w spoczynku, poprawione kodowanie opisu w package.json. Jedna próba optymalizacji
(leniwe ładowanie `App`) **pogorszyła start o ~300 ms w pomiarze A/B i została wycofana**. Największy realny zysk
to dysk: 3 018 MB → 2 307 MB (cache kompilacji). Brak wycieku pamięci JS w 9-minutowej sesji nawigacji.

## 2. Dysk

Przed (2026-11-22, po wcześniejszym wyczyszczeniu `target` przez użytkownika i zbudowaniu instalatora 0.15.4):

| Ścieżka | Rozmiar | Pliki | % | Klasyfikacja |
|---|---:|---:|---:|---|
| `src-tauri\target` (razem) | 2 838,9 MB | 8 326 | 94,1 | REGENERABLE (cache Cargo) |
| — `target\release` (w tym exe 6,9 MB, instalator 2,8 MB) | 1 761,4 MB | 4 294 | 58,4 | REGENERABLE; exe/instalator = artefakt |
| — `target\debug` | 1 077,1 MB | 4 028 | 35,7 | REGENERABLE |
| — `target\flycheck0` (rust-analyzer) | 0,4 MB | 2 | 0,0 | REGENERABLE |
| `node_modules` | 168,4 MB | 3 419 | 5,6 | REGENERABLE (npm ci), potrzebne do builda |
| `.git` | 3,7 MB | 897 | 0,1 | REQUIRED SOURCE |
| `src` + `src-tauri\src` + migracje | 3,6 MB | 351 | 0,1 | REQUIRED SOURCE |
| `docs` | 1,6 MB | 34 | 0,1 | REQUIRED SOURCE |
| `dist` | 1,3 MB | 74 | 0,0 | REGENERABLE (vite build) |
| `src-tauri\gen`, `icons` | 0,5 MB | 22 | 0,0 | gen: REGENERABLE; icons: SOURCE |
| **Razem** | **3 018,3 MB** | 13 147 | 100 | |

Podczas pracy buildy testowe/pomiarowe powiększyły `target\debug` do 8 737 MB (razem 10 991 MB). Usunięto
`target\debug` i `target\flycheck0`; 53,8 MB (23 pliki) zostało, bo DLL-e makr proceduralnych trzyma otwarte
`rust-analyzer` w edytorze. **Po: 2 307 MB** (target 2 128 MB, głównie `release`). `target\debug` odrośnie po
`cargo check` / `npm run app:dev` / `npm run test:rust` (rzędu 1–9 GB, zależnie od tego, ile profili się zbuduje).

Poza repo (nie ruszane): `%APPDATA%\app.vaalytics.desktop` 26,7 MB (baza 16 MB + cache Trade/craftingu — RUNTIME,
dane użytkownika); `%LOCALAPPDATA%\app.vaalytics.desktop` 192,9 MB — profil WebView2 (`Code Cache` 73 MB,
`Cache` 46 MB; zawiera też ciasteczka/logowania kart przeglądarki, więc nie czyścić bez zgody);
`C:\Users\User\Vaalytics-backup` 4,6 MB (backup użytkownika); kopia wirtualizacji MSIX
`...\Packages\Claude_...\LocalCache\Roaming\app.vaalytics.desktop` 5,7 MB (stare kopie cache z sesji dev — UNKNOWN
dla aplikacji, bezpieczne, zostawione).

## 3. Wydajność (tylko zmierzone wartości)

Warunki: build debug z wbudowanym frontendem (`tauri build --debug --no-bundle`, jedyny wariant z
`VAALYTICS_DATA_DIR`), kopia prawdziwej bazy (v10, 69 tys. punktów historii cen), cache craftingu i Trade,
świeży profil WebView2, przebiegi naprzemienne A/B/A/B. CPU w debug jest wyższe niż w release — liczy się porównanie.
Rynek pobierał dane z poe.ninja w trakcie przebiegów (wahania sieci).

| Metryka | Przed (base2 / base3) | Po (new1 / new2 / final) | Wniosek |
|---|---|---|---|
| Start: proces → wyrenderowana nawigacja, mediana 6 przebiegów | 382 ms | 435 ms (z 1. zimnym startem 834 ms) | w szumie; czas w stronie ~100 ms w obu |
| Start: CDP target → nawigacja (mediana) | 82 ms | 86 ms (final) / **391 i 386 ms z leniwym `App`** | leniwy `App` wycofany |
| Host RAM private, spoczynek 60 s | 10,6 / 10,3 MB | 10,7 / 10,3 MB | bez zmian |
| WebView2 RAM private (6 procesów), spoczynek | 245,5 / 260,2 MB | 249,0 / 274,9 MB | bez zmian |
| CPU spoczynek host / WebView2 | 0,8/0,7 · 0,2/4,4 % | 0,2/0,5 · 0,2/0,2 % | w szumie |
| CPU na stronie Location Atlas (60 s) host / WebView2 | 0,3/0,2 · 0,6/1,1 % | 0,6/1,3 · 0,3/0,6 % | niemierzalne tą metodą |
| IPC `market_overview` (947 unikatów), mediana 10 wywołań | 17,1 / 20,5 ms | 18,7 / 19,2 ms | ten sam czas, ale już poza wątkiem UI |
| IPC `get_diagnostics` | 15,5 / 15,5 ms | 19,0 / 24,1 ms | j.w. |
| Pierwsza wizyta modułu (klik → stabilna klatka) | 2–65 ms (Crafting 50–65) | 3–51 ms | bez zmian |
| Szczyt RAM hosta przy przebudowie danych craftingu z RePoE | 274–284 MB private | bez zmian | rekomendacja |
| Sterta JS po GC, 60 rund nawigacji (~9 min, ~1000 przejść) | — | 16,7–21,3 MB, DOM stały (243 węzły na Settings) | brak wycieku JS |
| WebView2 private w trakcie intensywnej nawigacji / po niej | — | plateau 610–675 MB / 421 MB w spoczynku | cache renderera, nie rośnie liniowo |
| Host private w sesji 9 min | — | 20,8 → 29,2 MB | lekki wzrost, do obserwacji |
| `dist` | 1 386 773 B | bez zmian (po wycofaniu leniwego `App`) | |
| Instalator NSIS | 2 966 124 B (0.15.4) | 2 971 025 B (0.15.5) | +4,9 KB |
| `vaalytics.exe` release | ~6,9 MiB | 7 202 816 B (6,87 MiB) | bez zmian |

Niedostępne/niewiarygodne: pomiary na buildzie release (używa prawdziwej bazy — celowo nie uruchamiany); zysk
z przeniesienia komend z wątku UI (widoczny tylko przy rywalizacji o połączenie DB z zapisem w tle — nie
zasymulowany).

## 4. Zmienione pliki

- `src-tauri/src/commands.rs` — `get_diagnostics`, `market_overview`, `market_history`, `session_list`,
  `session_detail` są `async`: synchroniczne komendy Tauri wykonują się na wątku głównym, więc czekanie na mutex
  bazy (np. podczas zapisu rynku/importu logu) lub pełne odświeżenie listy procesów (sysinfo) blokowało UI.
  Ustawienia zostały synchroniczne (krótkie, zachowują kolejność zapisów).
- `src/games/poe1/location-atlas/hooks.ts` — usunięty nieużywany stan `syncing`, który co 2 s (gdy Atlas widoczny)
  wywoływał dwa re-rendery całego Atlasu/okna Atlasu.
- `src/core/settings/SettingsPage.tsx` — listener `overlay:status` jest odpinany także wtedy, gdy strona zniknie,
  zanim `listen()` się rozwiąże (wcześniej wyciekał).
- `src-tauri/src/session/process.rs` — `EnumWindows` (tytuły okien) tylko gdy działa proces klienta PoE; wcześniej
  przy każdym skanie co 5 s, także bez gry.
- `src/main.tsx` — leniwe `App` wprowadzone i wycofane po pomiarze (stan końcowy = jak w 0.15.4).
- `package.json` — `description` miał zepsute kodowanie (mojibake zamiast „—”).
- `scripts/perf-measure.mjs` (nowy), `docs/development/setup.md`, `docs/architecture/overview.md` — powtarzalne
  pomiary i zasady (wątek UI, chunk wejściowy).
- Wersja 0.15.5: `package.json`, `src-tauri/Cargo.toml` (+`Cargo.lock`), `src-tauri/tauri.conf.json`.

Bez zmian: migracje (brak nowych — indeksy pokrywają gorące zapytania), zależności npm/cargo, profil release,
konfiguracja Vite, wygląd, ustawienia, dane użytkownika, zachowanie wobec GGG.

## 5. Naprawione błędy

1. Wyciek listenera `overlay:status` w Ustawieniach.
2. Zbędne re-rendery Location Atlas co 2 s.
3. Ciężkie komendy odczytu na wątku UI (potencjalne zacięcia okna).
4. Zepsuty opis w `package.json`.

## 6. Testy (faktycznie uruchomione)

- `npm run check:all` po każdym etapie: typecheck OK, Vitest 347 passed / 4 skipped, Rust 138 passed / 7 ignored.
- `cargo check` OK.
- `npm run app:build` OK → `Vaalytics_0.15.5_x64-setup.exe` (2,83 MiB).
- Realna aplikacja przez CDP (build debug, kopia bazy): start, przejście przez wszystkie moduły PoE 1 (16) i PoE 2 (12),
  przełączanie gier, Ustawienia (General, Diagnostics — wartości się odświeżają), zamknięcie przyciskiem Close →
  proces kończy się. Zrzut Ustawień: wygląd bez zmian.
- Sesja wyciekowa: 60 rund, 539 s (krócej niż zalecane 15–30 min).
- Nie uruchomiono: `cargo test -- --ignored live_` (endpointy nie były zmieniane); buildu release na danych użytkownika.

## 7. Nierozwiązane

- Przebudowa danych craftingu parsuje całe pliki RePoE do `serde_json::Value` — szczyt ~280 MB RAM hosta
  (przejściowo, raz na dobę, gdy źródło się zmieniło).
- Host private rośnie 21 → 29 MB w 9 min intensywnej nawigacji (prawdopodobnie cache SQLite/rynku) — nie
  rozstrzygnięte w tak krótkim teście.
- Timeline w Session Intelligence nie jest wirtualizowany (wiersze o różnych wysokościach); w danych testowych tylko
  14 wizyt, więc korzyści nie dało się zmierzyć.
- Duplikaty zależności transitywnych Tauri (`windows-sys` 0.59/0.61, `hashbrown`, `syn` 2/3 …) — do usunięcia
  tylko aktualizacjami upstream.
- Część komend `async` wykonuje synchroniczne operacje na bazie na wątkach runtime (wzorzec projektu) — dopuszczalne,
  ale długie operacje (import logu, czyszczenie historii) mogłyby korzystać ze `spawn_blocking`.

## 8. Rekomendacje

1. Crafting: deserializacja RePoE do typowanych struktur (tylko potrzebne pola) — przy zachowaniu `engine.test.ts`.
2. Dłuższa sesja wyciekowa (30 min+) na buildzie release z kopią danych, by potwierdzić/wykluczyć wzrost hosta.
3. Wirtualizacja Timeline sesji, gdy pojawią się realne długie sesje (>100 wierszy) do pomiaru.
4. `target\debug` regularnie czyścić (`cargo clean --profile dev` lub usunięcie katalogu) — to 1–9 GB odtwarzalnego cache.
5. Nie ładować `App` leniwie (zmierzone +300 ms startu).
