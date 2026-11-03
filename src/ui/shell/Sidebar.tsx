import { Icon, type IconName } from '../icons/icons';
import { deckColour } from '../deckColour';
import { PLACEHOLDER_SUBJECTS } from '../placeholderSubjects';
import { Fragment, useState } from 'react';
import { MenuCard } from '../components/MenuCard';
import menuStyles from '../components/MenuCard.module.css';
import profilePicture from '../../assets/profile-placeholder.jpg';
import styles from './Sidebar.module.css';

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

interface SubjectMenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
}

/** Groups of actions; a divider is drawn between groups. The pin item flips between Unpin and Pin. */
function subjectMenuGroups(pinned: boolean): SubjectMenuItem[][] {
  return [
    [
      { label: 'New Deck', icon: 'newDeck' },
      { label: 'Colour', icon: 'droplet' },
    ],
    [{ label: 'Rename' }, pinned ? { label: 'Unpin' } : { label: 'Pin' }],
    [
      { label: 'Settings', icon: 'settings' },
      { label: 'Delete', icon: 'trash', danger: true },
    ],
  ];
}

/** Card that opens under a subject's triple-dot button. */
/** `pinned` is true on the sidebar rail, where every subject is pinned; pass false elsewhere to show Pin instead of Unpin. */
function SubjectMenuCard({ anchor, label, onClose, pinned = true }: { anchor: HTMLElement; label: string; onClose(): void; pinned?: boolean }) {
  const groups = subjectMenuGroups(pinned);
  const renderItem = (item: SubjectMenuItem) => (
    <button key={item.label} type="button" role="menuitem" className={`${menuStyles.menuItem} ${item.danger ? menuStyles.menuDanger : ''}`}>
      {item.icon && <Icon name={item.icon} />}
      <span>{item.label}</span>
    </button>
  );
  return (
    <MenuCard anchor={anchor} label={label} onClose={onClose}>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div className={menuStyles.menuRule} role="separator" />}
          {group.map(renderItem)}
        </Fragment>
      ))}
    </MenuCard>
  );
}

const PROFILE_MENU_ITEMS: { label: string; icon: IconName }[] = [
  { label: 'Import deck', icon: 'import' },
  { label: 'Appearance', icon: 'palette' },
  { label: 'Daily Limit', icon: 'dailyLimit' },
  { label: 'Help', icon: 'help' },
];

/** Card that opens beside the profile button. */
function ProfileMenuCard({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  return (
    <MenuCard anchor={anchor} label="Profile" onClose={onClose} placement="right">
      {PROFILE_MENU_ITEMS.map((item) => (
        <button key={item.label} type="button" role="menuitem" className={menuStyles.menuItem}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </MenuCard>
  );
}

export function Sidebar() {
  // Only one floating card is open at a time; `id` is 'profile' or `subject:<name>`.
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const toggleMenu = (id: string, anchor: HTMLElement) => setMenu((m) => (m?.id === id ? null : { id, anchor }));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleSubject = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
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
          aria-expanded={menu?.id === 'profile'}
          onClick={(e) => toggleMenu('profile', e.currentTarget)}
        >
          <img className={styles.avatar} src={profilePicture} alt="" />
          <span className={styles.userName}>{USER_NAME}</span>
        </button>
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
      <ul className={styles.rail} aria-label="Subjects">
        {PLACEHOLDER_SUBJECTS.map((d) => (
          <li key={d.name}>
            <div className={styles.railRow} data-open={menu?.id === `subject:${d.name}` || undefined}>
              <button
                type="button"
                className={styles.railItem}
                aria-expanded={d.subdecks.length > 0 ? !collapsed.has(d.name) : undefined}
                onClick={() => toggleSubject(d.name)}
              >
                <span className={styles.railLine} style={{ background: deckColour(d.colour) }} aria-hidden="true" />
                <span className={styles.railName}>{d.name}</span>
              </button>
              <button
                type="button"
                className={styles.moreButton}
                aria-label={`${d.name} options`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === `subject:${d.name}`}
                onClick={(e) => toggleMenu(`subject:${d.name}`, e.currentTarget)}
              >
                <Icon name="moreVertical" />
              </button>
            </div>
            {d.subdecks.length > 0 && (
              <div className={styles.subWrap} data-collapsed={collapsed.has(d.name) || undefined}>
                <div className={styles.subInner}>
                  <ul className={styles.subRail} aria-label={`${d.name} decks`}>
                    {d.subdecks.map((sub) => (
                      <li key={sub.name}>
                        <button type="button" className={`${styles.railItem} ${styles.subItem}`}>
                          <span className={styles.railName}>{sub.name}</span>
                          <span className={styles.railMore}><Icon name="moreVertical" /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={`${styles.action} ${styles.search} ${styles.settings}`}>
        <Icon name="settings" />
        <span>Settings</span>
      </button>
      {menu?.id === 'profile' && <ProfileMenuCard anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.id.startsWith('subject:') && (
        <SubjectMenuCard anchor={menu.anchor} label={`${menu.id.slice('subject:'.length)} options`} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
