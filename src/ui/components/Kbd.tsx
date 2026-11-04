import styles from './Kbd.module.css';

export function Kbd({ children }: { children: string }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

/** "Ctrl+Enter" → "Control+Enter", for aria-keyshortcuts. */
export function ariaKeys(kbd: string): string {
  return kbd.split('+').map((k) => ({ Ctrl: 'Control', Esc: 'Escape' })[k] ?? k).join('+');
}
