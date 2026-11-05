# Atlas: conventions to follow

These come from the person designing Atlas's front end. Keep to them in every change.

- **No pill buttons, ever.** Buttons are rounded rectangles (the `--radius-sm` / `--radius-btn` corner, 8px), never fully rounded. The shared `Button` already follows this through `--radius-btn`; don't set a button's `border-radius` to `999px` or `50%`.
- **Build only what's asked, one piece at a time.** The screens are being designed from scratch: when asked for a blank card, a placeholder button or an icon, add exactly that. Placeholder buttons look active and do nothing yet; don't grey them out.
- **Dropdowns on the home screen and the Add card overlay use `MenuCard`** (grouped rows, icons, red Delete), not the generic `Menu`.
- **Colours come from theme tokens.** `tests/ui/noLiteralColours.test.ts` rejects literal colours (even the words white and black in a CSS comment).
