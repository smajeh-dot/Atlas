import { Icon } from '../icons/icons';
import { deckColour } from '../deckColour';
import { useEffect, useRef, useState } from 'react';
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

/** Blank card that opens under a subject's triple-dot button. The dropdown options go inside it. */
function SubjectMenuCard({ anchor, label, onClose }: { anchor: HTMLElement; label: string; onClose(): void }) {
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
    <div ref={ref} className={styles.menuCard} role="menu" aria-label={label} style={{ top: rect.bottom + 4, left: rect.left }} />,
    document.body,
  );
}

export function Sidebar() {
  const [menu, setMenu] = useState<{ subject: string; anchor: HTMLElement } | null>(null);
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
              <button type="button" className={styles.railItem}>
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
            )}
          </li>
        ))}
      </ul>
      {menu && <SubjectMenuCard anchor={menu.anchor} label={`${menu.subject} options`} onClose={() => setMenu(null)} />}
    </div>
  );
}
