import type { DeckTreeWithCounts } from '../../services/deckService';
import { useAtlas, type Route } from '../app/AtlasContext';
import { Kbd } from '../components/Kbd';
import { deckColour } from '../deckColour';
import { Icon, type IconName } from '../icons/icons';
import profilePicture from '../../assets/profile-placeholder.jpg';
import styles from './Sidebar.module.css';

const NAV: { name: 'today' | 'decks'; label: string; icon: IconName }[] = [
  { name: 'today', label: 'Today', icon: 'today' },
  { name: 'decks', label: 'Decks', icon: 'decks' },
];

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

export function Sidebar({ tree, hasDecks }: { tree: DeckTreeWithCounts[]; hasDecks: boolean }) {
  const { route, navigate } = useAtlas();
  const go = (r: Route, enabled = true) => () => enabled && navigate(r);
  return (
    <div className={styles.sidebar}>
      <div className={styles.user} data-testid="sidebar-user">
        <img className={styles.avatar} src={profilePicture} alt="" />
        <span className={styles.userName}>{USER_NAME}</span>
      </div>
      <button
        type="button"
        className={styles.add}
        aria-current={route.name === 'add' ? 'page' : undefined}
        aria-keyshortcuts="A"
        onClick={go({ name: 'add' })}
      >
        <Icon name="plus" />
        <span className={styles.grow}>Add card</span>
        <span aria-hidden="true"><Kbd>A</Kbd></span>
      </button>
      <nav aria-label="Main" className={styles.nav}>
        {NAV.map((n) => (
          <button
            key={n.name}
            type="button"
            className={styles.item}
            aria-current={route.name === n.name ? 'page' : undefined}
            aria-disabled={!hasDecks || undefined}
            onClick={go({ name: n.name }, hasDecks)}
          >
            <Icon name={n.icon} size={18} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {tree.length > 0 && (
        <>
          <div className={styles.label} id="subjects-label">Subjects</div>
          <ul className={styles.subjects} aria-labelledby="subjects-label" aria-label="Subjects">
            {tree.map((n) => (
              <li key={n.deck.id}>
                <button type="button" className={styles.subject} title={n.deck.name} onClick={go({ name: 'study', deckId: n.deck.id })}>
                  <span className={styles.dot} style={{ background: deckColour(n.deck.colour) }} />
                  <span className={styles.subjectName}>{n.deck.name}</span>
                  <span className={styles.due}>{n.counts.learn + n.counts.review}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.spacer} />
      <button
        type="button"
        className={styles.item}
        aria-current={route.name === 'settings' ? 'page' : undefined}
        aria-keyshortcuts="Control+,"
        onClick={go({ name: 'settings' })}
      >
        <Icon name="settings" size={18} />
        <span>Settings</span>
      </button>
    </div>
  );
}
