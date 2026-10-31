// Bundled fonts (SIL Open Font License), latin subset only: Atlas works offline and never fetches web fonts.
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-600.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/instrument-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';

const FACES: [family: string, weights: number[]][] = [
  ['Source Serif 4', [400, 600]],
  ['Instrument Sans', [400, 500, 600]],
  ['JetBrains Mono', [400, 500]],
  ['Bricolage Grotesque', [600, 800]],
  ['DM Sans', [400, 500, 600]],
  ['DM Mono', [400, 500]],
];

const CAP_MS = 1500;

/**
 * Loads every face before the first paint so text never flashes in a fallback font.
 * Both themes are loaded because the Welcome and Appearance previews show them side by side.
 */
export async function loadFonts(): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fonts) return;
  const all = Promise.all(FACES.flatMap(([family, weights]) => weights.map((w) => fonts.load(`${w} 16px '${family}'`).catch(() => []))));
  await Promise.race([all, new Promise((r) => setTimeout(r, CAP_MS))]);
}
