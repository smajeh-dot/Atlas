import { Icon } from '../icons/icons';
import { deckColour } from '../deckColour';
import profilePicture from '../../assets/profile-placeholder.jpg';
import styles from './Sidebar.module.css';

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

const RAIL_PLACEHOLDERS = [
  { name: 'Deck name', colour: 1, subdecks: ['Sub-deck one', 'Sub-deck two'] },
  { name: 'Second deck', colour: 3, subdecks: ['Sub-deck one', 'Sub-deck two', 'Sub-deck three'] },
];

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
      {/* Quick-access rail for decks, placeholder entries for now. */}
      <ul className={styles.rail} aria-label="Quick access decks">
        {RAIL_PLACEHOLDERS.map((d) => (
          <li key={d.name}>
            <button type="button" className={styles.railItem}>
              <span className={styles.railLine} style={{ background: deckColour(d.colour) }} aria-hidden="true" />
              <span className={styles.railName}>{d.name}</span>
              <span className={styles.railMore}><Icon name="moreVertical" /></span>
            </button>
            {d.subdecks.length > 0 && (
              <ul className={styles.subRail} aria-label={`${d.name} sub-decks`}>
                {d.subdecks.map((sub) => (
                  <li key={sub}>
                    <button type="button" className={`${styles.railItem} ${styles.subItem}`}>
                      <span className={styles.railName}>{sub}</span>
                      <span className={styles.railMore}><Icon name="moreVertical" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
