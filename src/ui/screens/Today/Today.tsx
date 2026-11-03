import styles from './Today.module.css';

/** Today screen: intentionally empty, to be designed from the ground up. The data lives in services/todayService. */
export function Today() {
  return <div className={styles.page} data-testid="today-screen" />;
}
