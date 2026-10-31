import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons/icons';
import { Kbd } from './Kbd';
import styles from './Menu.module.css';
import { useOverlayLayer } from './overlayStack';

export type MenuItem =
  | { label: string; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; hint?: string; swatch?: string; onSelect(): void }
  | 'divider';

type Anchor = HTMLElement | { x: number; y: number };

function position(anchor: Anchor): { top: number; left: number } {
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { top: r.bottom + 4, left: r.left };
  }
  return { top: anchor.y, left: anchor.x };
}

export function Menu({ anchor, items, onClose, label }: { anchor: Anchor; items: MenuItem[]; onClose(): void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isTop = useOverlayLayer();
  const [pos, setPos] = useState(() => position(anchor));
  const opener = useRef<HTMLElement | null>(anchor instanceof HTMLElement ? anchor : (document.activeElement as HTMLElement | null));

  const enabled = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useLayoutEffect(() => {
    // Keep the menu on screen near the right and bottom edges.
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(pos.left, window.innerWidth - r.width - 8);
    const top = pos.top + r.height > window.innerHeight ? Math.max(8, pos.top - r.height - 40) : pos.top;
    if (left !== pos.left || top !== pos.top) setPos({ left: Math.max(8, left), top });
    enabled()[0]?.focus();
  }, []);

  const close = () => {
    onClose();
    queueMicrotask(() => opener.current?.focus());
  };

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isTop()) return;
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className={styles.menu} style={{ top: pos.top, left: pos.left }} onKeyDown={onKeyDown}>
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={`d${i}`} role="separator" className={styles.divider} />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            className={[styles.item, item.danger ? styles.danger : ''].join(' ')}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onSelect();
            }}
          >
            {item.swatch && <span className={styles.swatch} style={{ background: item.swatch }} />}
            {item.icon && <Icon name={item.icon} />}
            <span className={styles.text}>
              <span>{item.label}</span>
              {item.hint && <span className={styles.hint}>{item.hint}</span>}
            </span>
            {item.shortcut && <span aria-hidden="true"><Kbd>{item.shortcut}</Kbd></span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
