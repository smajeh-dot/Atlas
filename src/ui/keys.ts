import { useEffect, useRef } from 'react';
import { anyOverlayOpen } from './components/overlayStack';

/** Text fields, where letters are typing rather than shortcuts (spec 11). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range', 'reset'].includes(t.type);
  return t.isContentEditable || t.closest('[contenteditable="true"]') !== null;
}

const NAMES: Record<string, string> = { Space: ' ', Esc: 'Escape' };

/**
 * "Ctrl+Shift+C", "A", "@", "Space", "Alt+ArrowUp". Letters match either case; symbols match the
 * character typed (e.key), so "@" works whichever key makes it on the keyboard layout.
 */
export function matchKey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const keyPart = parts.pop()!;
  const mods = new Set(parts);
  const want = NAMES[keyPart] ?? keyPart;
  if (e.ctrlKey !== mods.has('Ctrl') || e.altKey !== mods.has('Alt') || e.metaKey) return false;
  const isLetter = /^[a-z]$/i.test(want);
  if (isLetter) {
    if (mods.has('Shift') !== e.shiftKey && mods.size > 0) return false;
    return e.key.toLowerCase() === want.toLowerCase();
  }
  // For symbols the Shift needed to type them is part of the character, so only check it when named.
  if (mods.has('Shift') && !e.shiftKey) return false;
  return e.key === want;
}

/**
 * App shortcuts on the whole window. While typing in a field only `allowInInputs` combos fire,
 * and nothing fires while a menu, dialog or sheet is open (they handle their own keys).
 */
export function useHotkeys(
  bindings: Record<string, (e: KeyboardEvent) => void>,
  opts: { enabled?: boolean; allowInInputs?: string[] } = {},
): void {
  const ref = useRef({ bindings, opts });
  ref.current = { bindings, opts };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { bindings: b, opts: o } = ref.current;
      if (o.enabled === false || e.defaultPrevented || anyOverlayOpen()) return;
      const typing = isTypingTarget(e.target);
      for (const [combo, run] of Object.entries(b)) {
        if (!matchKey(e, combo)) continue;
        if (typing && !(o.allowInInputs ?? []).includes(combo)) return;
        e.preventDefault();
        run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
