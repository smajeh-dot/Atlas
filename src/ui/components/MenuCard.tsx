import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './MenuCard.module.css';
import { useOverlayLayer } from './overlayStack';

/** Floating card anchored to a button, under it or (placement 'right') beside it with the top edges aligned: closes on outside click or Esc, and returns focus to the button. */
export function MenuCard({ anchor, label, onClose, className, placement = 'below', children }: { anchor: HTMLElement; label: string; onClose(): void; className?: string; placement?: 'below' | 'right'; children?: ReactNode }) {
  const isTop = useOverlayLayer();
  const rect = anchor.getBoundingClientRect();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTop()) {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key, true);
    };
  });
  return createPortal(
    <div ref={ref} className={`${styles.menuCard} ${className ?? ''}`} role="menu" aria-label={label} style={placement === 'right' ? { top: rect.top, left: rect.right + 4 } : { top: rect.bottom + 4, left: rect.left }}>
      {children}
    </div>,
    document.body,
  );
}
