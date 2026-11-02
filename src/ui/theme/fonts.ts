// Bundled fonts (Anthropic font kit); Atlas works offline and never fetches web fonts.
import './fonts.css';

const FACES: [family: string, weights: number[]][] = [
  ['Anthropic Sans', [500]],
  ['Anthropic Serif', [500]],
  ['Anthropic Mono', [400]],
];

const CAP_MS = 1500;

/**
 * Loads every face before the first paint so text never flashes in a fallback font.
 * All three families are loaded up front.
 */
export async function loadFonts(): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fonts) return;
  const all = Promise.all(FACES.flatMap(([family, weights]) => weights.map((w) => fonts.load(`${w} 16px '${family}'`).catch(() => []))));
  await Promise.race([all, new Promise((r) => setTimeout(r, CAP_MS))]);
}
