import styles from './Notch.module.css';

/** The tab hanging from the top of the Today screen. It's blank for now; quick-access buttons are added to it one at a time. */
export function Notch() {
  return (
    <div className={styles.anchor}>
      <div className={styles.notch} role="toolbar" aria-label="Quick actions" data-testid="today-notch" />
    </div>
  );
}
