import { useAtlas } from '../../app/AtlasContext';
import { useHotkeys } from '../../keys';
import styles from './Session.module.css';

const GRADES = [
  { word: 'Again', cls: 'again' },
  { word: 'Hard', cls: 'hard' },
  { word: 'Good', cls: 'good' },
  { word: 'Easy', cls: 'easy' },
];

/**
 * The study session screen: a completely blank page, to be designed from the ground up.
 * Opened from a sub-deck row or Study All on Today. Esc returns to Today so the blank page is never a dead end.
 * (The earlier working Study screen is still in the project, but nothing links to it.)
 */
export function Session({ target }: { target?: string }) {
  const { navigate } = useAtlas();
  // 1-4 are the grade shortcuts (Again, Hard, Good, Easy). They do nothing yet; grading is not built.
  const grade = () => {};
  useHotkeys({ Esc: () => navigate({ name: 'today' }), '1': grade, '2': grade, '3': grade, '4': grade });
  return (
    <div className={styles.page} data-testid="session-screen" data-target={target}>
      <div className={styles.stack}>
        <section className={styles.card} aria-label="Flashcard" data-testid="session-card" />
        <div className={styles.row}>
          {GRADES.map(({ word, cls }, i) => (
            <button key={word} type="button" className={`${styles.smallCard} ${styles[cls]}`} data-testid="session-small-card" onClick={grade}>
              <span className={styles.key} aria-hidden="true">{i + 1}</span>
              <span className={styles.label}>{word}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
