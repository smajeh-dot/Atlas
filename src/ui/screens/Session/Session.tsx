import { useAtlas } from '../../app/AtlasContext';
import { useHotkeys } from '../../keys';
import styles from './Session.module.css';

/**
 * The study session screen: a completely blank page, to be designed from the ground up.
 * Opened from a sub-deck row or Study All on Today. Esc returns to Today so the blank page is never a dead end.
 * (The earlier working Study screen is still in the project, but nothing links to it.)
 */
export function Session({ target }: { target?: string }) {
  const { navigate } = useAtlas();
  useHotkeys({ Esc: () => navigate({ name: 'today' }) });
  return (
    <div className={styles.page} data-testid="session-screen" data-target={target}>
      <div className={styles.stack}>
        <section className={styles.card} aria-label="Flashcard" data-testid="session-card" />
        <div className={styles.row}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.smallCard} data-testid="session-small-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
