import { Icon, type IconName } from '../icons/icons';
import { deckColour } from '../deckColour';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayLayer } from '../components/overlayStack';
import profilePicture from '../../assets/profile-placeholder.jpg';
import styles from './Sidebar.module.css';

// Placeholder until real user profiles exist.
const USER_NAME = 'Harry';

const RAIL_PLACEHOLDERS = [
  { name: 'Biology', colour: 1, subdecks: ['Sub-deck one', 'Sub-deck two'] },
  { name: 'Maths', colour: 3, subdecks: ['Sub-deck one', 'Sub-deck two', 'Sub-deck three'] },
];

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

/** Card that opens under a subject's triple-dot button. The dropdown options go inside it. */
/** `pinned` is true on the sidebar rail, where every subject is pinned; pass false elsewhere to show Pin instead of Unpin. */
function SubjectMenuCard({ anchor, label, onClose, pinned = true }: { anchor: HTMLElement; label: string; onClose(): void; pinned?: boolean }) {
  const groups = subjectMenuGroups(pinned);
  const renderItem = (item: SubjectMenuItem) => (
    <button key={item.label} type="button" role="menuitem" className={`${styles.menuItem} ${item.danger ? styles.menuDanger : ''}`}>
      {item.icon && <Icon name={item.icon} />}
      <span>{item.label}</span>
    </button>
  );
  const isTop = useOverlayLayer();
  const rect = anchor.getBoundingClientRect();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTop()) {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key, true);
    };
  });
  return createPortal(
    <div ref={ref} className={styles.menuCard} role="menu" aria-label={label} style={{ top: rect.bottom + 4, left: rect.left }}>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div className={styles.menuRule} role="separator" />}
          {group.map(renderItem)}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

export function Sidebar() {
  const [menu, setMenu] = useState<{ subject: string; anchor: HTMLElement } | null>(null);
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
      <ul className={styles.rail} aria-label="Subjects">
        {RAIL_PLACEHOLDERS.map((d) => (
          <li key={d.name}>
            <div className={styles.railRow} data-open={menu?.subject === d.name || undefined}>
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
                aria-expanded={menu?.subject === d.name}
                onClick={(e) => {
                  const anchor = e.currentTarget;
                  setMenu((m) => (m?.subject === d.name ? null : { subject: d.name, anchor }));
                }}
              >
                <Icon name="moreVertical" />
              </button>
            </div>
            {d.subdecks.length > 0 && (
              <div className={styles.subWrap} data-collapsed={collapsed.has(d.name) || undefined}>
                <div className={styles.subInner}>
                  <ul className={styles.subRail} aria-label={`${d.name} decks`}>
                    {d.subdecks.map((sub) => (
                      <li key={sub}>
                        <button type="button" className={`${styles.railItem} ${styles.subItem}`}>
                          <span className={styles.railName}>{sub}</span>
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
      {menu && <SubjectMenuCard anchor={menu.anchor} label={`${menu.subject} options`} onClose={() => setMenu(null)} />}
    </div>
  );
}
