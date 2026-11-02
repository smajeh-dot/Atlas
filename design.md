# Atlas light mode: design brief

Status: approved direction, **not yet implemented**. Feed this file to the implementing session.
Branch: `phase-2-study-loop` (all work lands here; do not push elsewhere).

## 1. Purpose

Light mode (the theme currently called **Workbench**, id `workbench`) must look refined, professional and calm, in the spirit of an Apple product launch with a Claude-like feel. It will be shipped to classmates, so polish matters. It has few distractions so the user can focus on flashcards, with occasional pops of accent colour and personality (pixel art and animation). No liquid-glass visuals.

Scope: light mode only. The Tangerine theme is untouched.

## 2. Palette (fixed by the owner)

| Role | Value | Use |
|---|---|---|
| Page background | `#f9f9f7` | default app background |
| Card | `#ffffff` | every card that holds information |
| Primary blue | `#237bdb` | selection, focus, primary buttons, a break in monotony |
| Success | `#29853e` | confirmation, success, "Good" grade |
| Danger | `#d13c30` | failure, danger buttons, "Again" grade, errors |
| Muted amber | **TBD, supplied by owner** | "Hard" grade and warnings only. Do NOT reuse the old `#9A6A00` / `#FDF3DC` / `#7A5300`. Define it as a single token (`--amber`) with a clearly marked placeholder, so the owner's value drops in. |

Rules:
- Blue marks selection or a deliberate break in the page. It is not decoration.
- Green and red are semantic only (success/failure/danger).
- Derive soft tints (`--accent-soft`, `--focus-soft`, success/danger tints) from these hexes, not new hues.
- Primary buttons are **blue** with white text. Near-black buttons are removed in light mode.

## 3. Cards and shape

- Every card uses a **12px** radius unless a section says otherwise.
- Remove the squared-corner quirk: `--radius-card` (`14px 14px 14px 0`), `--radius-panel-side` and `--radius-panel-main` all become plain `12px`. `--radius-lg` becomes `12px`.
- Buttons use 12px. Small inner elements (kbd chips, tags, toasts, tooltips) use a smaller, tokenised radius that reads as proportional inside a 12px card. Pills stay pill-shaped only for toggles, sliders and progress.
- Cards sit on the page with a 1px hairline border and no heavy shadow. Popovers keep one soft shadow.
- Today's hero is currently bare text on the page. Put it in a card.

## 4. Implementation notes (from the code audit)

- Colours live in `src/ui/theme/workbench.css`. Change tokens there so components follow. Shared colours (flags, deck colours, count colours, heat, bar) are in `tokens.css` and `workbench.css` and should be re-tuned to harmonise with the new blue/green/red.
- Hard-coded radii to move onto tokens: `FieldEditor` (4, 6px), `Heatmap` (3px), `Kbd` (5px), `Toast` (10px), `Segmented` (9, 7px), `Tooltip` (6px), `BarChart` (4px), `Study.module.css` (`.key` 6px), `icons.module.css` (4px).
- Layout files that consume panel/card radii: `Shell.module.css`, `Sidebar.module.css`, `Study.module.css`, `Today.module.css`, `Decks.module.css`, `Settings.module.css`, `Editor.module.css`, `ThemeCards.module.css`, `Dialog.module.css`, `Menu.module.css`, `Select.module.css`, `TagInput.module.css`.
- Keep the stored theme id `workbench` (it is persisted in settings and validated in `src/core/validate.ts` and `src/core/model.ts`). Only the **display name** changes to "Light" (see `ThemeCards.tsx`, Welcome and Settings copy).
- `tests/ui/theme.test.ts` pins the old hex values for both themes. Update the Workbench column to the new values and keep the Tangerine column. `tests/ui/noLiteralColours.test.ts` must keep passing: no raw hex in components.
- Both theme files must keep declaring the identical token set (a test enforces it), so any new token (such as `--amber`) must also be added to `tangerine.css` with a sensible value.

## 5. Improvement list (from the handoff rules)

1. Apply the palette tokens: `--bg-app`, `--bg-main`, `--bg-panel`, `--accent`, `--focus`, `--success`, `--danger` and their soft tints.
2. Semantic colour mapping: "Good" and due counts green; "Again", delete and error red; "Hard" and warnings amber (owner's value); "Easy" blue.
3. Blue is used for selection (active sidebar item, selected segment, focus ring), and the single primary action per screen. Remove other blue uses where they add noise (new-count, heat) in favour of neutral or green.
4. Uniform 12px card radius (section 3).
5. White cards on the off-white page with hairline borders; hero in a card.
6. Sidebar on the page colour with a quiet blue-tint active state.
7. Primary buttons blue, 12px radius; danger buttons `#d13c30`.
8. Study screen: grade buttons are plain white cards with coloured text and a tinted hover. "Show answer" is the single blue action. Nothing competes with the card.
9. Replace stray hard-coded radii with tokens (section 4).
10. Re-tune deck colours (1–8) and flag colours (1–7) to sit with the palette while staying distinguishable.
11. Charts and heatmap: blue or green on a neutral track, no rainbow.
12. One consistent focus ring: blue with a soft halo on every control.
13. Typography: keep Source Serif 4 headings and Instrument Sans body; tighten the heading scale and verify `--text-faint` contrast on `#f9f9f7`.
14. Toasts and dialogs: white cards, hairline, subtle shadow; semantic colour only as a small icon or edge.
15. Welcome and theme picker: rename "Workbench" to "Light" in the UI and refresh the preview cards to the new palette.
16. Empty states: add a pixel-art slot (section 7).
17. Motion: short, gentle fade/lift on card flip and screen change; keep the reduced-motion handling.
18. Update tests (section 4).

## 6. Ten extra improvements (beyond the handoff)

Do these in a **second pass**, after section 5 is done and verified.

1. Dark-mode readiness: semantic tokens (`--surface`, `--surface-sunken`) so a future dark mode is a token swap.
2. Study-mode focus: fade the sidebar and chrome while studying so only the card, progress and grades remain.
3. Progress: a slim line at the top of the study screen instead of a separate bar.
4. Keyboard hints: show shortcut chips until the user has used them a few times, then hide them.
5. Number rhythm: tabular numbers and consistent label/value alignment on Today and stats cards.
6. Answer reveal: short slide-and-fade, native-feeling, no bounce.
7. Streak without pressure: a calm "N days" figure in a card, no flames or red warnings.
8. Session summary: a finish card (cards reviewed, time, retention) with one "Done" button.
9. Spacing grid: snap odd paddings (34/44px, 18px gaps) onto the existing spacing steps.
10. Accessibility pass: contrast check on every text/colour pair, 44px minimum hit targets on grade buttons, visible focus everywhere.

## 7. Pixel art and animation

Used sparingly, in places the user discovers. They also greet the user on entry to the app and on deck completion.

The owner chose three assets. They are being produced **in a separate Claude session as a motion artifact**, so assume they will be supplied. Do not draw them yourself. Build the integration slots and take the assets as inputs.

| Asset | Where it appears |
|---|---|
| Card stack (shuffling) | Empty Decks screen; can also serve as the app-entry greeting |
| Trophy (star burst) | Deck-completion moment on the study screen |
| Sleeping cat | "All done for today" state on Today |

Implementation guidance:
- Render each as a small component under `src/ui/components/` (for example `PixelCardStack`, `PixelTrophy`, `PixelCat`), with a static fallback frame.
- Respect `prefers-reduced-motion`: show the static frame, no animation.
- Pixel art must render crisp (`image-rendering: pixelated`, integer scaling).
- No other pixel art is added unless the owner asks.
- Dropped from the shortlist: Atlas globe and waving figure.

## 8. Decisions already made

- Hard grade: muted amber, owner supplies the value.
- Primary buttons: blue `#237bdb`.
- Pixel art: card stack, trophy, sleeping cat, supplied separately.
- Scope: section 5 first, section 6 as a follow-up pass.

## 9. Open items

- Amber hex from the owner.
- The pixel-art assets and their format (SVG, sprite sheet or animated component).
- Whether the "Light" rename should also appear in documentation and README.

## 10. Definition of done

- All of section 5 applied; `npm run typecheck`, `npm test` and `npm run build` pass.
- Visual check of every screen (Welcome, Today, Decks, Study, Editor, Settings, dialogs, toasts, menus) in light mode, and a check that Tangerine is unchanged.
- Committed and pushed to `phase-2-study-loop`. No PR unless requested.
