import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { trapTab, useOverlayLayer, useRestoreFocus } from '../../components/overlayStack';
import styles from './ImportOverlay.module.css';

/** A blank card in the middle of the window with everything around it darkened. Esc or a click outside the card closes it. */
export function ImportOverlay({ onClose }: { onClose(): void }) {
  const card = useRef<HTMLDivElement>(null);
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => card.current?.focus(), []);

  return createPortal(
    <div
      className={styles.overlay}
      data-testid="import-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="Import"
        tabIndex={-1}
        className={styles.card}
        onKeyDown={(e) => {
          if (!isTop()) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else trapTab(e, card.current);
        }}
      />
    </div>,
    document.body,
  );
}
