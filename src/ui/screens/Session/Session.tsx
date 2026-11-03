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
  const done = index >= MOCK_CARDS.length;
  const card = MOCK_CARDS[index];

  const flip = () => {
    if (done) return false;
    setFlipped((f) => !f);
  };
  // Mock grading: any of the four moves on to the next card. Nothing is recorded yet.
  const grade = () => {
    if (done || !flipped) return false;
    setFlipped(false);
    setIndex((i) => i + 1);
  };
  const restart = () => {
    setIndex(0);
    setFlipped(false);
  };
  useHotkeys({
    Esc: () => navigate({ name: 'today' }),
    Space: flip,
    Enter: flip,
    '1': grade,
    '2': grade,
    '3': grade,
    '4': grade,
  });

  return (
    <div className={styles.page} data-testid="session-screen" data-target={target}>
      <div className={styles.stack}>
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
              onClick={grade}
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
