import styles from './Today.module.css';

/** Today screen, being designed from the ground up. The central card is where the decks will go. */
export function Today() {
  return (
    <div className={styles.page} data-testid="today-screen">
      <section className={styles.decksCard} aria-label="Decks" data-testid="today-decks-card">
        <div className={styles.decksHeader} />
        <div className={styles.decksRule} role="separator" />
      </section>
    </div>
  );
}
