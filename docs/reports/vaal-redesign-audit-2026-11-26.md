# Redesign „Vaal / Obsidian Instrument” — etap A: audyt wizualny

Data: 2026-11-26 · baza: `7048c6b` (0.20.2) · punkt powrotu: lokalny tag `pre-vaal-redesign`.
Audyt kodu (bez zmian w UI). Zrzuty „przed” zrobię na starcie etapu B, z własnej instancji (CDP, `VAALYTICS_DATA_DIR`).

## 1. Obecna architektura wizualna

| Warstwa | Gdzie | Stan |
|---|---|---|
| Tokeny | `src/styles/index.css` `@theme` | Kompletne grupy (powierzchnie, linie, akcent, tekst, status, rarity, typografia, radius, cienie, motion). Dobra baza — zmiana wartości przenosi się na całą aplikację. |
| Utility powierzchni | `panel`, `panel-raised`, `well`, `glass`, `glass-nav`, `glass-float`, `atmo-*`, `ornament-rule` | Gradientowe obramowania + wielowarstwowe cienie + `backdrop-filter: blur`. Sprzeczne z briefem (glassmorphism, gradienty, cienie). |
| Tło aplikacji | `src/app/Atmosphere.tsx` | Światło kluczowe (ciepłe / chłodne dla PoE 2), grawerowany rysunek atlasu (`atlas-lines.svg`, 7 % / 3.5 %), dwuskalowe ziarno, winieta. Brief zakazuje „ilustracji za treścią” i atmosferycznych efektów — do usunięcia. |
| Komponenty | `src/shared/components` (18 plików) | Button, IconButton, Input, Select, Switch, Checkbox, SegmentedControl, Badge/Kbd, Panel/PageHeader, StatTile/ChangeText, Modal, Toast, NavItem, EmptyState/Skeleton, ProvenanceTag, SampleDataNotice, ErrorBoundary. Moduły z nich korzystają (189× `<Panel>`, 44× `PageHeader`) — duża dźwignia. |
| Wykresy | `src/shared/charts` (AreaChart, BarChart, Sparkline, `scale.ts`) | Bez biblioteki, czyste SVG, ResizeObserver, tooltip, klawiatura ←/→. Zostaje; poprawki tylko wizualne. |
| Tabele | brak wspólnego komponentu | 13 ręcznie pisanych `<table>`, ≥ 8 różnych stylów nagłówka (`text-2xs`/`text-xs`, uppercase lub nie, `font-normal`/`medium`/`semibold`, różne paddingi). |
| Ikony | `src/shared/icons/icons.ts` | Jeden zestaw, 55 ikon, siatka 20×20, kreska 1.5 px, test siatki. Spójne — zostaje. |
| Fonty | systemowe | Segoe UI Variable Text/Display + Cascadia Mono. Brak dołączonych fontów. |
| Motion | `src/shared/design/motion.ts` | Presety 120–260 ms, `MotionConfig reducedMotion`. Dobre. Wyjątki: rysowanie linii wykresu 0,7 s, `hover:scale-105` 700 ms na grafice w sidebarze, `-translate-y-px` na hoverze kafli i przycisków. |

## 2. Niespójności (konkretne)

1. **Akcent jest neonowo-pomarańczowy** (`#F28C38`, `accent-glow`, gradient na przycisku primary, cień `0 0 8px` na znaczniku nawigacji, kropka wykresu z halo). Brief: brąz/miedź, oszczędnie, bez poświaty.
2. **Biel z alfą jako linie i tła** (`line` = 7 % bieli, `bg-white/[0.04]` itp.) — kontrast zależy od tła pod spodem, więc ta sama „linia” ma różną jasność na `bg`, `surface` i `elevated`. Zastąpić pełnymi kolorami.
3. **Wartości ad hoc mimo tokenów**: 57× `text-[Npx]` (najwięcej: TrackerWindow Loot Journal 21, Act Tracker 12, GameShell 3), 18× `shadow-[…]`, 28× `rgb(…)` w komponentach, 6× hex (Button primary, GameSelection).
4. **Etykiety uppercase z dużym trackingiem** w 36 miejscach (grupy nawigacji, StatTile, eyebrow strony, TrackerWindow, Tools, Crafting). Brief: unikać.
5. **Promienie**: 5 wartości w użyciu (`xs` 4 → `xl` 14), `rounded-lg` 41×, `rounded-xl` 13×. Za miękko jak na „architektoniczną” geometrię.
6. **Liczby**: część tabel używa Cascadia Mono (18 plików), część Segoe `tabular-nums` — dwa różne „głosy” liczb obok siebie.
7. **Tabele**: brak wspólnych reguł wysokości wiersza, wyrównania, nagłówka, sortowania, stanów hover/zaznaczenia.
8. **Hover z ruchem**: kafle i przyciski unoszą się o 1 px, przycisk się skaluje — brief: bez zbędnego ruchu.
9. **`led-edge`** (PoE 2, StatTile): czerwony pierścień + halo — sprzeczny z zakazem poświaty, ale dodany na życzenie użytkownika → **decyzja użytkownika** (pkt 6).

## 3. Główne problemy UX

- **Shell**: sidebar 236 px na szkle z rozmyciem; aktywny element = gradientowa „pigułka” z obwódką i świecącą krawędzią — to dokładnie „rounded container” z briefu. Nagłówki grup: 10 px uppercase z trackingiem 0.16em. Przełącznik gry: 72 px grafiki + szklany przycisk; zjada miejsce na nawigację (≈ 20 modułów w PoE 1).
- **Nagłówek strony**: eyebrow (uppercase, akcent) + tytuł 22 px + ornament z gradientem pod każdym nagłówkiem — dekoracja powtarzana na każdej stronie; kontrolki kontekstowe (liga, waluta, akcje) bez stałego miejsca w niektórych modułach.
- **Dashboard**: 4 identyczne kafle tej samej wagi (w tym „Watchlist: N items”, który nie jest metryką rynkową), wykres i watchlista w równych panelach, „Biggest movers” jako zwykła tabela pod spodem. Brak hierarchii: kurs Divine (główna informacja) ma tę samą wagę co licznik watchlisty. Marginesy 32×28 i `gap-5` = sporo pustego miejsca przy 1920 px; kontener `max-w-[1360px]` zostawia puste pasy na 2560 px.
- **Wykres**: gradient pod linią, animowane rysowanie 0,7 s, kropka z halo, tylko 3 etykiety dat, brak min/max/zakresu, tooltip na szkle.
- **Stany puste/ładowania**: EmptyState w okrągłym „medalionie” — dobry komponent, ale ikona w kółku powtarza się wszędzie.

## 4. Komponenty do ponownego użycia (bez przepisywania logiki)

Wszystkie komponenty z `@/shared/components`, wykresy, `market-ui.tsx` (`ItemIcon`, `LeagueSelect`, `DisplayCurrencySelect`, `FreshnessBar`), `ProvenanceTag`, `ItemCard`. Brakuje: **`DataTable`/klas tabeli** (nagłówek, wiersz, komórka liczbowa, wskaźnik sortowania) i **`Stat`** (wartość / zmiana / kontekst / znacznik czasu z rozróżnioną hierarchią) — dodam je do `@/shared/components`, nie jako duplikaty.

## 5. Obszary wysokiego ryzyka

- **Kolizje z innymi sesjami** (ta sama kopia robocza, bez worktree): pliki modułów Loot Journal, Price Checker, Ultimatum, Deck Intelligence, Update Center, Campaign Intelligence, Act Tracker. Etapy B–D dotykają tylko `index.css`, `src/shared/components`, `src/shared/charts`, `src/app/*`, `DashboardView`, docs design-systemu. Moduły (etap E) — pojedynczo, po sprawdzeniu `git status` danego folderu.
- **Okna narzędziowe / overlay** (`OverlayApp`, `ToolWindow`, `TrackerWindow` ×2) używają przezroczystego tła i `glass` — muszą pozostać czytelne nad grą; zmiany tokenów sprawdzić tam osobno.
- **Item renderer** — kolory rarity/modów to kolory gry, nie zmieniam.
- **Grafika wyboru gry (0.20.1)** — zostaje bez zmian. W sidebarze proponuję mniejszy, spokojniejszy przełącznik (ta sama grafika, bez zoomu na hover).
- **Performance**: usunięcie `backdrop-filter` i warstw atmosfery tylko zmniejszy koszt GPU; zmierzę w Diagnostics.

## 6. Kierunek etapu B (propozycja wartości)

- **Materiał**: obsydian jako warstwy jasności, pełne kolory, bez blur/gradientów/szkła; cień tylko pod elementami pływającymi (menu, modal, tooltip).
  `bg #101113 · bg-2 #141518 · surface #17191C · elevated #1C1E21 · elevated-2 #222428 · well #0D0E10`;
  linie `line #25272B · line-strong #33353A`.
- **Tekst**: `fg #E7E3DB · fg-muted #A09B91 · fg-subtle #74716B · fg-disabled #4B4A47` (ciepła kość/kamień; kontrast sprawdzę skryptem).
- **Brąz**: `bronze #795536` (linie identyfikacji, aktywny znacznik) · `copper #A2764B` · `accent #C08A4E` (primary, zaznaczony punkt danych) · `accent-2 #D0A36D` (tekst akcentu). Bez `accent-glow`.
- **Semantyka** (funkcjonalna, lekko przygaszona): success `#5BB287` · danger `#D8665C` · warning `#D3A64A` · info `#6E9FD6`.
- **Typografia**: zostaje Segoe UI Variable (natywne, najlepszy rendering na Windows; żadnych nowych fontów). Skala 11 · 12 · 13 · 14 · 16 · 20 · 28 (liczby główne). Wszystkie liczby: Segoe `tabular-nums lining-nums`; Cascadia Mono tylko dla kodu/REGEX. Etykiety: zdanie, 12 px, `fg-muted`, bez trackingu; uppercase tylko w jednym miejscu (grupy nawigacji, 11 px, umiarkowany tracking) — albo wcale.
- **Geometria**: promienie 2 / 3 / 4 (pływające: 6). Siatka 4 px; wysokości kontrolek 28 / 32; wiersz tabeli 32 (gęsty 28).
- **Sygnatury Vaal (mały, stały zestaw)**:
  1. aktywny element nawigacji — pionowy pręt z brązu 2 px ze **schodkowym ścięciem** (stopień piramidy), bez pigułki i tła;
  2. nagłówek sekcji/strony — krótki „nadproże” (lintel): 16 px linii brązu ze ściętym końcem przed tytułem; zamiast ornamentu pod każdym nagłówkiem;
  3. separator — włos z małym schodkowym wcięciem, tylko w nagłówku strony i w stopce sidebaru;
  4. znak Vaalytics w pasku tytułu — bez zmian (istniejący `vaalytics.svg`).
  Wszystko inne bez ornamentów.
- **Motion**: bez unoszenia na hoverze, bez skalowania; zmiana koloru 120 ms; wskaźniki (nav, segmenty) — krótki tween zamiast sprężyny; wykres bez animacji rysowania.

## 7. Zalecana kolejność

B (tokeny + utility + komponenty bazowe, doc design-systemu) → C (TitleBar, sidebar, PageHeader, kontener treści, tło) → D (Dashboard + wykresy + `DataTable`) → E moduły pojedynczo: Currency Tracker → Price Checker → Market Intelligence → Update Center → Deck Intelligence → Campaign Intelligence / Act Tracker / Location Atlas → Loot Journal / Session Intelligence → Crafting, REGEX, Ultimatum → Trade, Builds, Tools, Browser, Settings → okna overlay/tracker → F (QA 1920×1080 / 2560×1440 / małe okno, `npm run check:all`, CDP).
Commit po każdym etapie (i po każdym module w E). Bez pushowania i wydania bez zgody.

## Decyzje dla użytkownika

1. Zgoda na etapy B–D w tym kierunku.
2. **`led-edge` (czerwona krawędź kafli PoE 2)**: zostawić bez zmian / zamienić na stonowany 1 px czerwony górny brzeg bez poświaty / usunąć.
3. Usunięcie atmosfery tła (rysunek atlasu, ziarno, światło kluczowe, winieta) — zalecane przez brief („bez ilustracji za treścią”).
