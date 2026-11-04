import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Dialog.module.css';
import { focusables, trapTab, useOverlayLayer, useRestoreFocus } from './overlayStack';

/** Every confirmation in Atlas (spec 9). Esc cancels; Enter in a field confirms; focus stays inside. */
export function Dialog({ title, children, confirmLabel, confirmVariant = 'primary', cancelLabel = 'Cancel', hideCancel, confirmDisabled, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  cancelLabel?: string;
  /** For dialogs that only inform, such as Card info. */
  hideCancel?: boolean;
  confirmDisabled?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const field = root.querySelector<HTMLElement>('input, textarea, select');
    if (field) {
      field.focus();
      if (field instanceof HTMLInputElement) field.select();
    } else {
      // Destructive dialogs start on Cancel: one stray Enter or Space must never delete anything.
      const start = confirmVariant === 'danger' && !hideCancel ? 'cancel' : 'confirm';
      focusables(root).find((el) => el.dataset.role === start)?.focus();
    }
  }, []);

  return createPortal(
    <div className={styles.overlay}>
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirmDisabled) onConfirm();
        }}
        onKeyDown={(e) => {
          if (!isTop()) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else trapTab(e, ref.current);
        }}
      >
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.buttons}>
          {!hideCancel && <Button variant="secondary" data-role="cancel" onClick={onCancel}>{cancelLabel}</Button>}
          <Button variant={confirmVariant} type="submit" data-role="confirm" disabled={confirmDisabled}>{confirmLabel}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
