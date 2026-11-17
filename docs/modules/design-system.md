# Design system

Location: `src/styles/index.css` (tokens), `src/shared/design` (motion, dev gallery),
`src/shared/icons` (icon set), `src/shared/components` (primitives).
Dev builds include a live gallery at **Settings → Design system** (excluded from production bundles).

## 0.2 refresh (Nov 2026)
- Palette: canvas `#101114`, nav `#17191D`, elevated `#202329`; ambient `app-backdrop` (two static light pools + faint grain) gives glass something to refract.
- Surfaces: `glass` and `glass-float` use a gradient border (lit top edge) instead of glow; `glass-nav` tints sidebar/title bar; `panel` is near-opaque for data.
- Buttons: hover lift (−1 px), primary gradient with accent illumination on hover, press scale 0.98, disabled desaturate — transform/box-shadow only.
- New components: animated keyboard-accessible `Select` (portal listbox; ↑↓ Home End Enter Esc type-ahead), `ToastProvider/useToast`, `EmptyState`, `Skeleton` (static).
- Navigation grouped (Market / Builds / Web), planned sections marked "Soon" and shown as honest placeholders.

## Principles
1. **Data first.** Prices, tables and listings sit on *solid* surfaces (`panel`, `bg-surface`). Glass is for chrome, navigation and floating UI only.
2. **Compact desktop density.** 13 px is the default UI size; headings stay modest (page title 20 px).
3. **One accent.** Orange (`accent`) marks primary action and current location. Status colours are reserved for status.
4. **Quiet motion.** Short, transform/opacity-only, never looping.

## Tokens
| Group | Tokens |
|---|---|
| Canvas → raised | `bg` #111214 · `bg-2` #16181C · `surface` #1B1D22 · `elevated` #22252B · `elevated-2` #2A2E35 |
| Translucent | `glass` 4.5 % · `glass-hover` 6 % · `glass-strong` 7.5 % white |
| Lines | `line` 7.5 % · `line-strong` 13 % white |
| Brand | `accent` #F28C38 · `accent-2` #FFAD62 · `accent-soft` 14 % · `on-accent` #1A1006 |
| Text | `fg` #F5F5F5 · `fg-muted` #A1A5AE · `fg-subtle` #6F747E · `fg-disabled` |
| Status | `success` · `warning` · `danger` · `info`, each with a `-soft` background |
| Radius | `xs` 4 · `sm` 6 · `md` 8 · `lg` 12 · `xl` 16 |
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
