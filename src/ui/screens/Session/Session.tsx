import { useState } from 'react';
import { MOCK_CARDS } from '../../placeholderCards';
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
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // How many cards have been marked Again, Hard, Good and Easy so far (mock; nothing is saved).
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const done = index >= MOCK_CARDS.length;
  const card = MOCK_CARDS[index];
  const marked = counts.reduce((a, b) => a + b, 0);

  const flip = () => {
    if (done) return false;
    setFlipped((f) => !f);
  };
  // Mock grading: the card is counted under its grade and the next one comes up. Nothing is saved.
  const grade = (which: number) => {
    if (done || !flipped) return false;
    setCounts((c) => c.map((n, i) => (i === which ? n + 1 : n)));
    setFlipped(false);
    setIndex((i) => i + 1);
  };
  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setCounts([0, 0, 0, 0]);
  };
  useHotkeys({
    Esc: () => navigate({ name: 'today' }),
    Space: flip,
    Enter: flip,
    '1': () => grade(0),
    '2': () => grade(1),
    '3': () => grade(2),
    '4': () => grade(3),
  });

  return (
    <div className={styles.page} data-testid="session-screen" data-target={target}>
      <div className={styles.stack}>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Session progress"
          aria-valuemin={0}
          aria-valuemax={MOCK_CARDS.length}
          aria-valuenow={marked}
          data-testid="session-progress"
        >
          {GRADES.map(({ word, cls }, i) => (
            <span key={word} className={`${styles.segment} ${styles[cls]}`} style={{ width: `${((counts[i] ?? 0) / MOCK_CARDS.length) * 100}%` }} />
          ))}
        </div>
        <section
          className={styles.card}
          aria-label="Flashcard"
          data-testid="session-card"
          onClick={done ? undefined : flip}
        >
          {done ? (
            <div className={styles.face}>
              <p className={styles.text}>All done</p>
              <button type="button" className={styles.restart} onClick={restart}>
                Go again
              </button>
            </div>
          ) : (
            <>
              <span className={styles.count}>
                {index + 1} / {MOCK_CARDS.length}
              </span>
              <div className={styles.face}>
                <p className={flipped ? styles.textSmall : styles.text}>{card?.front}</p>
                {flipped && (
                  <>
                    <hr className={styles.rule} />
                    <p className={styles.text}>{card?.back}</p>
                  </>
                )}
              </div>
              <span className={styles.hint}>{flipped ? 'Choose how well you knew it' : 'Click or press Space to show the answer'}</span>
            </>
          )}
        </section>
        <div className={styles.row}>
          {GRADES.map(({ word, cls }, i) => (
            <button
              key={word}
              type="button"
              className={`${styles.smallCard} ${styles[cls]}`}
              data-testid="session-small-card"
              aria-disabled={!flipped || done}
              onClick={() => grade(i)}
            >
              <span className={styles.key} aria-hidden="true">{i + 1}</span>
              <span className={styles.label}>{word}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
