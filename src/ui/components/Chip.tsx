import { Icon } from '../icons/icons';
import styles from './Chip.module.css';

export function Chip({ children, ghost, onRemove, removeLabel }: { children: string; ghost?: boolean; onRemove?(): void; removeLabel?: string }) {
  return (
    <span className={ghost ? `${styles.chip} ${styles.ghost}` : styles.chip}>
      <span className={styles.text}>{children}</span>
      {onRemove && (
        <button type="button" className={styles.remove} aria-label={removeLabel ?? `Remove ${children}`} onClick={onRemove}>
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}
