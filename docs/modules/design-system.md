# Design system

Location: `src/styles/index.css` (tokens), `src/shared/design` (motion, dev gallery),
`src/shared/icons` (icon set), `src/shared/components` (primitives).
Dev builds include a live gallery at **Settings → Design system** (excluded from production bundles).

## "Vaal / Obsidian instrument" redesign (0.21, Nov 2026) — current
Supersedes the 0.6 and 0.2 notes below wherever they disagree. Audit: `docs/reports/vaal-redesign-audit-2026-11-26.md`.
Rollback point: local tag `pre-vaal-redesign`.

**Idea.** An analytical instrument made by a precise ancient civilisation: layered dark stone, warm bone text,
aged bronze used sparingly, near-square geometry. Beautiful through proportion and typography; it must still
work with every ornament removed.

- **Material.** Solid colours only: `bg` #101113 → `bg-2` #141518 → `surface` #17191C → `elevated` #1C1E21 →
  `elevated-2` #232528; `well` #0D0E10 for recessed fields. Lines are solid hex (`line` #25272B, `line-strong`
  #33353A) so a hairline weighs the same on every surface. No blur, glass, glow, gradients or ambient light.
  Shadows only under floating layers (menus, modals, toasts, tooltips).
- **Legacy utility names kept** so modules compile unchanged: `glass` / `glass-nav` (now solid chrome), `glass-float`
  (solid elevated + shadow), `panel-raised` (panel + bronze top hairline), `ornament-rule` (plain hairline),
  `bg-glass*` (low-alpha warm tints, for hover/selection only). `Atmosphere` now only sets `data-game`.
- **Bronze.** `bronze` #795536 (identity marks) · `copper` #A2764B (focus ring, selected outline) · `accent`
  #C08A4E (primary button, active indicator, selected data point, chart line) · `accent-2` #D0A36D (accent text).
  Not for headings, borders of ordinary panels, or every icon.
- **Text.** `fg` #E7E3DB · `fg-muted` #A09B91 · `fg-subtle` #88857D (metadata only; ≥ 4.5:1 on `bg`, `surface`, `elevated`) · `fg-disabled` #4B4A47.
- **Status** stays functional: `success` #5BB287 · `danger` #D8665C · `warning` #D3A64A · `info` #6E9FD6.
- **Typography.** Segoe UI Variable Text/Display (native, best ClearType rendering; no bundled fonts). Page title
  20 px semibold; panel title 13 px semibold; headline figures 24 px display, `tabular`; labels 12 px sentence case,
  `fg-muted` — no tracked uppercase micro-labels. All numbers use `tabular` (Segoe tabular lining figures);
  Cascadia Mono only for code / regex.
- **Geometry.** Radii `xs` 2 · `sm`/`md` 3 · `lg` 4 · `xl` 6 (floating only). Control heights 28 (`sm`) / 32 (`md`);
  table rows 36 (dense 32), header 32; panel header 40; panel padding 16; grid gap 16; page padding 28 × 20;
  content width `max-w-page` (1560 px).
- **Vaal marks (closed set).** `vaal-lintel` — short bronze bar with a stepped end before the page eyebrow;
  `vaal-step` — the active-nav marker (2 px accent bar, chamfered ends); `vaal-rule` — hairline that starts with a
  bronze segment and one step (sidebar footer). Nothing else is ornamental.
- **Shell.** Title bar 34 px; sidebar 220 px solid `bg-2`; game switcher 56 px (user artwork under a scrim, no zoom);
  group labels 11 px sentence case; nav items 32 px, active = tint + `vaal-step` + accent icon (no pill).
- **Page header.** Eyebrow (lintel + "Group · Game"), title, description; contextual controls right-aligned on
  the title baseline; one hairline below.
- **Tables.** `Table` / `Th` (`numeric`, `sort`, `onSort` → `aria-sort` + chevron) / `Tr` (`selected`) / `Td`
  (`numeric`, `muted`) / `ItemCell` (icon + truncating name + optional sub-line). Hairline row separators,
  numeric columns right-aligned and tabular.
- **Charts.** Dashed recessive grid, solid axis baseline with ticks, width-aware date labels (2–8, always first and
  last), 1.5 px accent line over a faint fill, a marker on the latest value, dashed crosshair + solid tooltip.
  No draw-in animation.
- **Stat / StatTile.** `Stat` is a figure without a surface (for strips, e.g. Dashboard key prices with
  `divide-x`); `StatTile` = `Stat` on `panel-raised`. Both keep the PoE 2 `led-edge` (user request; unchanged).
- **Motion.** Colour transitions 120 ms; no hover lift or press scale; shared-layout indicators use a 180 ms tween
  (no spring); page enter = 4 px rise + fade.
- **Background (Atmosphere, added on the user's request).** `src/app/Atmosphere.tsx` + `atmo-*` classes in
  `index.css`: tonal obsidian base with a faint cool wash; an original line drawing of a stepped Vaal pyramid (seven
  terraces, carved course lines, central stair, shrine) in copper at 16 % behind the content area, masked towards the
  top, fading in once (1.6 s); static two-scale stone grain; one warm light behind the pyramid (PoE 2: crimson) that
  breathes over 22 s — the app's only looping animation, transform/opacity only, paused while the window is hidden and
  removed by Settings → Reduce motion or Windows reduced motion. Panels on top stay solid; this layer is the only
  place gradients are used.
- **Dashboard: What's new / Game data.** Release notes come from `src/core/app/changelog.ts` (bundled, written from the
  release commits; add an entry with every version bump; `unreleased` entries describe changes already in the build).
  The version is `package.json`'s, injected by Vite (`__APP_VERSION__`). Game data status is the Update Center overview
  (one read on mount, then its events).

## 0.6 visual rework (Nov 2026) — superseded
- **Atmosphere** (`src/app/Atmosphere.tsx`, `atmo-*` utilities): static layers behind the app,
  outside every scroll container — key light (warm for PoE 1, cooler `data-game="poe2"`),
  an original etched atlas drawing (`src/assets/atmosphere/atlas-lines.svg`, 12 KB, 3.5–7 %
  opacity, radial mask), two-scale stone/ash grain (`soft-light`) and a vignette. No animation;
  idle WebView2 CPU measured at 0.0 %.
- **Surface language**: `panel` (solid data), `panel-raised` (hero tiles, faint warm top light),
  `well` (recessed fields, table headers), `glass-*` for chrome/floating UI only.
- **Page header**: eyebrow "Group · Game" from `PageContext` (set by the shell), 22 px title,
  `ornament-rule` hairline (warm → neutral → transparent) under every header.
- **Nav**: active item = warm left-lit pill with a 2 px accent edge inside the pill
  (no longer clipped by the scrolling nav); group labels end in a fading rule.
- **Controls**: primary button is a solid accent with a lit top edge (no neon glow); disabled
  states are neutral (not washed-out orange); inputs and text areas are `well`s; segmented
  controls sit in a well with a raised thumb.
- **Motion**: `stagger` container preset (dashboard tiles), chart line draws once per data set
  (`pathLength`, 0.7 s), area fades in; all respect `MotionConfig reducedMotion`.
- **Layout**: every page uses the same centred `max-w-[1360px]` container; forms (Settings)
  stay ≤ `max-w-4xl` inside it so the left edge always aligns.
- Scrollbars: thin rounded WebView2 (`::-webkit-scrollbar`) thumbs.

## 0.2 refresh (Nov 2026)
- Palette: canvas `#101114`, nav `#17191D`, elevated `#202329`; ambient `app-backdrop` (two static light pools + faint grain) gives glass something to refract.
- Surfaces: `glass` and `glass-float` use a gradient border (lit top edge) instead of glow; `glass-nav` tints sidebar/title bar; `panel` is near-opaque for data.
- Buttons: hover lift (−1 px), primary gradient with accent illumination on hover, press scale 0.98, disabled desaturate — transform/box-shadow only.
- New components: animated keyboard-accessible `Select` (portal listbox; ↑↓ Home End Enter Esc type-ahead), `ToastProvider/useToast`, `EmptyState`, `Skeleton` (static).
- Navigation grouped (Market / Builds / Web), planned sections marked "Soon" and shown as honest placeholders.

## Principles
1. **Data first.** Prices, tables and listings sit on *solid* surfaces (`panel`, `bg-surface`). Glass is for chrome, navigation and floating UI only.
2. **Compact desktop density.** 13 px is the default UI size; headings stay modest (page title 22 px).
3. **One accent.** Orange (`accent`) marks primary action and current location. Status colours are reserved for status.
4. **Quiet motion.** Short, transform/opacity-only, never looping.

## Tokens
| Group | Tokens |
|---|---|
| Canvas → raised | `bg` #0F1013 · `bg-2` #15171B · `surface` #191B20 · `elevated` #1F2228 · `elevated-2` #272B32 · `well` #121418 |
| Translucent | `glass` 4.5 % · `glass-hover` 6 % · `glass-strong` 7.5 % white |
| Lines | `line` 7 % · `line-strong` 12 % white · `line-warm` accent 28 % |
| Brand | `accent` #F28C38 · `accent-2` #FFAD62 · `accent-soft` 14 % · `on-accent` #1A1006 |
| Text | `fg` #F5F5F5 · `fg-muted` #A1A5AE · `fg-subtle` #6F747E · `fg-disabled` |
| Status | `success` · `warning` · `danger` · `info`, each with a `-soft` background |
| Radius | `xs` 4 · `sm` 6 · `md` 7 · `lg` 10 · `xl` 14 |
| Shadow | `sm` · `md` · `lg` |
| Layout | `titlebar` 36 px · `sidebar` 232 px |

## Typography
Segoe UI Variable (Text / Display optical sizes), Cascadia Mono for numbers in tables.
Scale: `2xs` 11 · `xs` 12 · `sm` 13 · `base` 14 · `lg` 16 · `xl` 20 · `2xl` 24 (each with a fixed line height).
Use `tabular` on any column of numbers.

## Spacing
Tailwind's 4 px grid. Conventions: control heights 28 (`h-7`, sm) / 34 (`h-8.5`, md); panel padding 16; page padding 32 × 28; gap between panels 20.

## Surfaces (utilities)
- `glass` — chrome/nav, blur 16 px.
- `glass-float` — modals/popovers, 82 % opaque, blur 24 px.
- `panel` — solid data container.

Blur is used on at most a few large, static surfaces at a time to keep GPU cost low.

## Motion (`src/shared/design/motion.ts`)
| Preset | Use |
|---|---|
| `duration.instant` 120 ms | hover/press |
| `duration.fast` 160 ms | menus, exits |
| `duration.base` 220 ms | pages, panels |
| `duration.slow` 260 ms | modals, overlay expand |
| `transition.layout` (spring) | moving indicators (nav, segmented control, switch) |
| `variants.fade / rise / pop` | backdrop / page content / modal |

Reduced motion: `MotionConfig reducedMotion` is `"user"` (follows Windows) or `"always"` when **Settings → Reduce motion** is on. CSS transitions are also neutralised under `prefers-reduced-motion`.

## Icons
Single set in `icons.ts`: 20 × 20 grid, 1.5 px stroke, round caps/joins, outline only. Render via `<Icon name size />` (16 default, 14 dense, 18–20 emphasis). Icons are decorative (`aria-hidden`) unless given a `label`. A unit test enforces the grid bounds.

## Components
| Component | Notes |
|---|---|
| `Button` | `primary` / `secondary` / `ghost` / `danger`, `sm` / `md`, leading/trailing icon, `loading` |
| `IconButton` | requires `label` (accessible name + tooltip) |
| `Input` | label, hint, error, leading icon, suffix (unit or `Kbd`) |
| `Switch` | `role="switch"`, label + description |
| `SegmentedControl` | `radiogroup` with animated thumb |
| `Badge`, `Kbd` | status tones; keyboard chips |
| `Panel`, `PageHeader` | solid/glass containers; page title row |
| `Modal` | portal, focus trap, Esc/backdrop close, focus restore |
| `NavItem` | sidebar item with shared-layout active indicator |
| `Spinner` | only mounted while loading |
| `Checkbox`, `Select` | native inputs, styled; Select keeps native keyboard/a11y |
| `StatTile`, `ChangeText` | headline numbers; change always has sign + arrow, never colour alone |
| `SampleDataNotice` | **mandatory** on any screen rendering sample data |
| `ErrorBoundary` | contains a crashing section |

## Charts (`src/shared/charts`)
No chart library. `AreaChart` (single series, accent line 2 px, recessive grid, crosshair + tooltip on hover and ←/→ keyboard focus, gutter sized from tick labels, compact ticks) and `Sparkline` (decorative, `aria-hidden`; the adjacent change % carries the value). Pure SVG, no animation loop. Up/down colours are status colours paired with sign and arrow.

## Item renderer (`src/shared/item-renderer`)
`ItemCard` renders a `DisplayItem`: rarity-coloured header, properties, mods grouped (enchant/rune → implicit → explicit), crafted/fractured tags, tiers, corruption, and a warning row for unparsed lines (never silently dropped). Rarity/mod colours are tokens (`rarity-*`, `mod-*`).

## Window chrome
The native frame is disabled (`decorations: false`, `shadow: true`); `src/app/TitleBar.tsx` draws the title bar with drag region, double-click maximise and Windows-style caption buttons. Window permissions are limited to minimise / toggle-maximise / close / start-dragging on the `main` window.
Known limitation: the Windows 11 Snap Layouts flyout does not appear on hover of the custom maximise button (Win+Z and edge-snapping still work).
