import { useEffect, useRef } from 'react';

/**
 * Open menus, dialogs and sheets, newest last. Only the top one reacts to Esc and keeps focus,
 * and app-wide shortcuts stay quiet while any is open.
 */
const stack: symbol[] = [];

export function anyOverlayOpen(): boolean {
  return stack.length > 0;
}

export function useOverlayLayer(): () => boolean {
  const id = useRef(Symbol('overlay'));
  useEffect(() => {
    const me = id.current;
    stack.push(me);
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
  return () => stack[stack.length - 1] === id.current;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** Keeps Tab inside `root` (spec 8.11: dialogs trap focus). */
export function trapTab(e: React.KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const items = focusables(root);
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Returns focus to whatever had it before the overlay opened. */
export function useRestoreFocus(): void {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);
}
