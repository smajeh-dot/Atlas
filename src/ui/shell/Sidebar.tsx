import { useState } from 'react';
import type { Deck } from '../../core/model';
import type { DeckTreeWithCounts } from '../../services/deckService';
import { Icon, type IconName } from '../icons/icons';
import { deckColour } from '../deckColour';
import { useDeckMenu } from '../screens/Today/DeckMenu';
import { MenuCard } from '../components/MenuCard';
import menuStyles from '../components/MenuCard.module.css';
import profilePicture from '../../assets/profile-placeholder.jpg';
import { useAtlas } from '../app/AtlasContext';
import styles from './Sidebar.module.css';

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

const PROFILE_MENU_ITEMS: { label: string; icon: IconName }[] = [
  { label: 'Daily Limit', icon: 'dailyLimit' },
  { label: 'Help', icon: 'help' },
];

/** Card that opens beside the profile button. */
function ProfileMenuCard({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  // None of the profile items do anything yet.
  const actions: Record<string, (() => void) | undefined> = {};
  return (
    <MenuCard anchor={anchor} label="Profile" onClose={onClose} placement="right">
      {PROFILE_MENU_ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={menuStyles.menuItem}
          onClick={() => {
            const act = actions[item.label];
            if (!act) return;
            onClose();
            act();
          }}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </MenuCard>
  );
}

/** One deck in the rail and, underneath it, its sub-decks. A deck with sub-decks opens and closes when clicked; one without starts studying. */
function RailDeck({ node, depth, collapsed, onToggle, openId, onMore }: {
  node: DeckTreeWithCounts;
  depth: number;
  collapsed: ReadonlySet<number>;
  onToggle(id: number): void;
  openId: number | null;
  onMore(deck: Deck, anchor: HTMLElement): void;
}) {
  const { navigate } = useAtlas();
  const { deck, children } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(deck.id);
  return (
    <li>
      <div className={styles.railRow} data-open={openId === deck.id || undefined}>
        <button
          type="button"
          className={depth === 0 ? styles.railItem : `${styles.railItem} ${styles.subItem}`}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          onClick={hasChildren ? () => onToggle(deck.id) : () => navigate({ name: 'study', deckId: deck.id })}
        >
          {depth === 0 && <span className={styles.railLine} style={{ background: deckColour(deck.colour) }} aria-hidden="true" />}
          <span className={styles.railName}>{deck.name}</span>
        </button>
        <button
          type="button"
          className={styles.moreButton}
          aria-label={`${deck.name} options`}
          aria-haspopup="menu"
          aria-expanded={openId === deck.id}
          onClick={(e) => onMore(deck, e.currentTarget)}
        >
          <Icon name="moreVertical" />
        </button>
      </div>
      {hasChildren && (
        <div className={styles.subWrap} data-collapsed={isCollapsed || undefined}>
          <div className={styles.subInner}>
            <ul className={styles.subRail} aria-label={`${deck.name} decks`}>
              {children.map((child) => (
                <RailDeck key={child.deck.id} node={child} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} openId={openId} onMore={onMore} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
}

export function Sidebar({ decks }: { decks: DeckTreeWithCounts[] }) {
  const { route, navigate } = useAtlas();
  // Only one floating card is open at a time; the profile card here, a deck's card in `deckMenu`.
  const [profile, setProfile] = useState<HTMLElement | null>(null);
  const deckMenu = useDeckMenu();
  // Which decks are folded shut in this list. It isn't saved: the sidebar opens everything again next launch.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const toggleDeck = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className={styles.sidebar}>
      <div className={styles.user} data-testid="sidebar-user">
        <button
          type="button"
          className={styles.profileButton}
          aria-label={`${USER_NAME}, profile`}
          aria-haspopup="menu"
          aria-expanded={profile !== null}
          onClick={(e) => setProfile((p) => (p ? null : e.currentTarget))}
        >
          <img className={styles.avatar} src={profilePicture} alt="" />
          <span className={styles.userName}>{USER_NAME}</span>
        </button>
      </div>
      <button type="button" className={styles.action}>
        <Icon name="plus" />
        <span>New</span>
      </button>
      <button
        type="button"
        className={`${styles.action} ${styles.search}`}
        aria-current={route.name === 'today' ? 'page' : undefined}
        onClick={() => navigate({ name: 'today' })}
      >
        <Icon name="home" />
        <span>Home</span>
      </button>
      <button type="button" className={`${styles.action} ${styles.search} ${styles.decks}`}>
        <Icon name="decks" />
        <span>Decks</span>
      </button>
      <div className={styles.rule} role="separator" />
      <ul className={styles.rail} aria-label="Decks">
        {decks.map((node) => (
          <RailDeck key={node.deck.id} node={node} depth={0} collapsed={collapsed} onToggle={toggleDeck} openId={deckMenu.openId} onMore={deckMenu.toggle} />
        ))}
      </ul>
      <button type="button" className={`${styles.action} ${styles.search} ${styles.settings}`}>
        <Icon name="settings" />
        <span>Settings</span>
      </button>
      {profile && <ProfileMenuCard anchor={profile} onClose={() => setProfile(null)} />}
      {deckMenu.ui}
    </div>
  );
}
