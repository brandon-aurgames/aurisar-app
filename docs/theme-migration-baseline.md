# Theme migration baseline

This document is the review contract for the incremental Aurisar theme migration. The migration consolidates UI styling into eight base colors and one UI font while preserving product behavior.

## Source baseline

Run `pnpm run theme:audit` to inspect the current source inventory. Run `pnpm run theme:audit:update` only after reviewing intentional theme changes. CI runs `pnpm run theme:audit:check` so unrecorded palette or typography drift is visible in every pull request.

The check also rejects any repository path or text file that reintroduces the removed legacy serif display family or the retired warm UI accent values. These rules cover source, tests, scripts, documentation, mockups, standalone references, and email templates; they do not rewrite Git history.

The committed [`theme-token-baseline.json`](./theme-token-baseline.json) covers tracked runtime source under `src/` and `public/`, plus root HTML entries. Test files are excluded. It reports:

- Raw color occurrences and unique source values.
- Raw colors outside the primitive theme file.
- CSS custom-property definitions and references.
- JSX inline-style objects.
- Font declarations.
- References to the legacy serif display family, retired warm accent values, and legacy warm-accent names.
- The files with the highest hard-coded color counts.

Counts measure source migration progress. They do not prove that a value is rendered, visible, accessible, or part of the UI. The World renderer contains legitimate material and environment values, so each occurrence still requires classification before replacement.

## Approved UI primitives

| Role | Primitive | Value |
|---|---|---|
| Canvas | `neutral-950` | `#0C0E11` |
| Surface | `neutral-900` | `#161A20` |
| Raised surface | `neutral-800` | `#222831` |
| Border | `neutral-700` | `#38414C` |
| Secondary text | `neutral-400` | `#9AA5B1` |
| Primary text | `neutral-100` | `#E4E7EB` |
| Action, focus and success | `teal-300` | `#8FE3D2` |
| Danger and error | `red-300` | `#FF7078` |

Components consume semantic or component roles from `src/styles/theme.css`; they do not consume primitives directly. Transparency, scrims and hover states derive from these primitives.

## Visual capture matrix

Use Preview Mode with the development PIN documented in `AGENTS.md`. Capture each surface at **390 × 844**, **768 × 1024**, and **1440 × 1000** unless the row has a more specific requirement. Use stable preview data and the same viewport, browser, reduced-motion setting and screen state before comparing a migration pull request.

| Surface | Required state | Interaction checks |
|---|---|---|
| Login | Default, form error, forgot-password dialog | Keyboard order, visible focus, password visibility, Preview Mode |
| App shell | Home plus every bottom-nav selection | Safe areas, selected state, labels, 44px targets |
| Exercise library | Default, search, filters open, empty result | Virtual scrolling, sticky regions, selection state |
| Workout picker | Grouped list, search, staged exercise | Pull-to-exit, row height, scroll restoration, close behavior |
| Workout builder | Empty, populated, collapsed exercise, validation error | Drag/reorder, edit fields, save and details trigger |
| Quick log | Default, edited sets, validation, loading | Input focus, unit labels, submit protection |
| Completion | Success summary and badges | XP values unchanged, close/focus restoration |
| Trends | Cards and each chart type | Tooltip, series identification, narrow labels |
| Settings/profile | Default, destructive confirmation | Form controls, disabled state, confirm/cancel |
| Avatar | Swatches and mesh selection | Accessible names, selected state, keyboard selection |
| Sheet/dialog | Bottom, centered, stacked confirm | Escape, backdrop, focus entry/return, body scroll |
| Feedback | Toast, alert, empty, loading and error | Status naming, contrast, reduced motion |
| World | HUD plus every panel over light and dark scenery | Input capture, close behavior, readable compositing |
| Privacy/error boundary | Standalone page and fallback | Independent theme loading, recovery action |

For animation-sensitive captures, enable reduced motion. Exercise the standard motion path manually once to detect broken transitions. Do not refresh expected screenshots merely because a diff exists; approve intentional palette and font changes in the pull-request review.

## Behavior that must remain stable

- Authentication and Preview Mode.
- Workout selection, editing, saving, logging and completion.
- XP calculations, rewards, persistence and domain identifiers.
- Exercise filtering, virtual-list row geometry and scroll position.
- Modal stacking, Escape behavior, focus restoration and body scrolling.
- Chart data and interactions.
- Avatar state and World controls.
- Reduced-motion behavior, touch targets and safe-area layout.

## Migration rule

Each feature pull request updates the source inventory, records the affected matrix rows, and identifies any intentional visual difference. A lower raw-value count is evidence of consolidation; user-flow verification is still required before the draft is marked ready for review.
