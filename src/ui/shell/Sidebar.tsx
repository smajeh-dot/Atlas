import { Icon } from '../icons/icons';
import { deckColour } from '../deckColour';
import profilePicture from '../../assets/profile-placeholder.jpg';
import styles from './Sidebar.module.css';

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

export function Sidebar() {
  return (
    <div className={styles.sidebar}>
      <div className={styles.user} data-testid="sidebar-user">
        <img className={styles.avatar} src={profilePicture} alt="" />
        <span className={styles.userName}>{USER_NAME}</span>
      </div>
      <button type="button" className={styles.action}>
        <Icon name="plus" />
        <span>New</span>
      </button>
      <button type="button" className={`${styles.action} ${styles.search}`}>
        <Icon name="search" />
        <span>Search</span>
      </button>
      <button type="button" className={`${styles.action} ${styles.search}`}>
        <Icon name="bell" />
        <span>Today</span>
      </button>
      <button type="button" className={`${styles.action} ${styles.search} ${styles.decks}`}>
        <Icon name="decks" />
        <span>Decks</span>
      </button>
      <div className={styles.rule} role="separator" />
      {/* Quick-access rail for decks. A single placeholder entry for now. */}
      <ul className={styles.rail} aria-label="Quick access decks">
        <li>
          <button type="button" className={styles.railItem}>
            <span className={styles.railLine} style={{ background: deckColour(1) }} aria-hidden="true" />
            <span className={styles.railName}>Deck name</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
