import { Count } from '../../components/Count';
import { deckColour } from '../../deckColour';
import { PLACEHOLDER_SUBJECTS } from '../../placeholderSubjects';
import styles from './Today.module.css';

/** Today screen, being designed from the ground up. The central card is where the decks go (placeholder rows for now). */
export function Today() {
  return (
    <div className={styles.page} data-testid="today-screen">
      <section className={styles.decksCard} aria-label="Decks" data-testid="today-decks-card">
        <div className={styles.decksHeader}>
          <span>Deck</span>
          <span className={styles.num}>New</span>
          <span className={styles.num}>Learn</span>
          <span className={styles.num}>Due</span>
        </div>
        <div className={styles.decksRule} role="separator" />
        <div className={styles.rows}>
          {PLACEHOLDER_SUBJECTS.map((subject) => {
            const total = (k: 'new' | 'learn' | 'due') => subject.subdecks.reduce((n, d) => n + d[k], 0);
            return (
              <div key={subject.name} className={styles.group}>
                <div className={styles.row}>
                  <span className={styles.subjectName}>
                    <span className={styles.bar} style={{ background: deckColour(subject.colour) }} aria-hidden="true" />
                    {subject.name}
                  </span>
                  <span className={styles.num}><Count kind="new" value={total('new')} /></span>
                  <span className={styles.num}><Count kind="learn" value={total('learn')} /></span>
                  <span className={styles.num}><Count kind="due" value={total('due')} /></span>
                </div>
                {subject.subdecks.map((sub) => (
                  <div key={sub.name} className={styles.row}>
                    <span className={styles.subName}>{sub.name}</span>
                    <span className={styles.num}><Count kind="new" value={sub.new} /></span>
                    <span className={styles.num}><Count kind="learn" value={sub.learn} /></span>
                    <span className={styles.num}><Count kind="due" value={sub.due} /></span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
