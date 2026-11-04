import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Sheet.module.css';
import { focusables, trapTab, useOverlayLayer, useRestoreFocus } from './overlayStack';

/** Side panel from the right, used to edit a card from Study (and Browse later). */
export function Sheet({ title, children, footer, onRequestClose }: { title: string; children: ReactNode; footer: ReactNode; onRequestClose(): void }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => {
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) (focusables(root).find((el) => !el.closest('header')) ?? root).focus();
  }, []);
  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onRequestClose()}>
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={(e) => {
          if (!isTop()) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onRequestClose();
          } else trapTab(e, ref.current);
        }}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
        </header>
        <div className={styles.body}>{children}</div>
        <footer className={styles.footer}>{footer}</footer>
      </aside>
    </div>,
    document.body,
  );
}
