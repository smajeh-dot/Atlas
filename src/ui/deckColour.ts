// Literal token names so every colour stays a theme token (spec 8.1 rule 7).
const COLOURS = ['var(--deck-1)', 'var(--deck-2)', 'var(--deck-3)', 'var(--deck-4)', 'var(--deck-5)', 'var(--deck-6)', 'var(--deck-7)', 'var(--deck-8)'];
const FLAGS = ['var(--flag-1)', 'var(--flag-2)', 'var(--flag-3)', 'var(--flag-4)', 'var(--flag-5)', 'var(--flag-6)', 'var(--flag-7)'];

export const DECK_COLOUR_NAMES = ['Green', 'Amber-brown', 'Blue', 'Red', 'Purple', 'Teal', 'Gold', 'Pink'];
export const FLAG_NAMES = ['Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];

export function deckColour(n: number | null | undefined): string {
  return COLOURS[((n ?? 1) - 1 + COLOURS.length) % COLOURS.length]!;
}

export function flagColour(n: number): string {
  return FLAGS[n - 1] ?? 'transparent';
}
