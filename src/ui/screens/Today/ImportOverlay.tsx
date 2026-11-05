import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../icons/icons';
import { trapTab, useOverlayLayer, useRestoreFocus } from '../../components/overlayStack';
import styles from './ImportOverlay.module.css';

/** A card in the middle of the window with everything around it darkened. The X, Esc or a click outside the card closes it. The triple-dot button doesn't do anything yet. */
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
      >
        <div className={styles.corner}>
          <button type="button" className={styles.cornerButton} aria-label="More options" aria-haspopup="menu">
            <Icon name="moreVertical" />
          </button>
          <button type="button" className={styles.cornerButton} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
