import { Fragment, useState } from 'react';
import { Count } from '../../components/Count';
import { MenuCard } from '../../components/MenuCard';
import menuStyles from '../../components/MenuCard.module.css';
import { deckColour } from '../../deckColour';
import { Icon, type IconName } from '../../icons/icons';
import { PLACEHOLDER_SUBJECTS } from '../../placeholderSubjects';
import styles from './Today.module.css';

interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
}

/** Menu for a subject row, in groups with a divider between them. All placeholders: none of the items does anything yet. */
const SUBJECT_MENU_GROUPS: MenuItem[][] = [
  [{ label: 'Study All' }],
  [{ label: 'New Deck', icon: 'newDeck' }, { label: 'Rename' }, { label: 'Colour', icon: 'droplet' }, { label: 'Unpin' }],
  [{ label: 'Delete', icon: 'trash', danger: true }],
];

/** Today screen, being designed from the ground up. The central card is where the decks go (placeholder rows for now). */
export function Today() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  // One blank dropdown at a time; `id` is the subject or sub-deck it belongs to.
  const [menu, setMenu] = useState<{ id: string; label: string; anchor: HTMLElement; kind: 'subject' | 'subdeck' } | null>(null);
  const toggleMenu = (id: string, label: string, anchor: HTMLElement, kind: 'subject' | 'subdeck') =>
    setMenu((m) => (m?.id === id ? null : { id, label, anchor, kind }));

  return (
    <div className={styles.page} data-testid="today-screen">
      <section className={styles.decksCard} aria-label="Decks" data-testid="today-decks-card">
        <div className={styles.decksHeader}>
          <span>Deck</span>
          <span className={styles.num}>New</span>
          <span className={styles.num}>Learn</span>
          <span className={styles.num}>Due</span>
          <span />
        </div>
        <div className={styles.decksRule} role="separator" />
        <div className={styles.rows}>
          {PLACEHOLDER_SUBJECTS.map((subject) => {
            const total = (k: 'new' | 'learn' | 'due') => subject.subdecks.reduce((n, d) => n + d[k], 0);
            const isCollapsed = collapsed.has(subject.name);
            return (
              <div key={subject.name} className={styles.group}>
                <div className={styles.rowWrap} data-open={menu?.id === subject.name || undefined}>
                  <button type="button" className={`${styles.row} ${styles.rowMain}`} aria-expanded={!isCollapsed} onClick={() => toggle(subject.name)}>
                    <span className={styles.subjectName}>
                      <span className={styles.bar} style={{ background: deckColour(subject.colour) }} aria-hidden="true" />
                      {subject.name}
                    </span>
                    <span className={styles.num}><Count kind="new" value={total('new')} /></span>
                    <span className={styles.num}><Count kind="learn" value={total('learn')} /></span>
                    <span className={styles.num}><Count kind="due" value={total('due')} /></span>
                    <span />
                  </button>
                  <button
                    type="button"
                    className={styles.rowMore}
                    aria-label={`${subject.name} options`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === subject.name}
                    onClick={(e) => toggleMenu(subject.name, `${subject.name} options`, e.currentTarget, 'subject')}
                  >
                    <Icon name="moreVertical" />
                  </button>
                </div>
                <div className={styles.subWrap} data-collapsed={isCollapsed || undefined}>
                  <div className={styles.subInner}>
                    {subject.subdecks.map((sub) => (
                      <div key={sub.name} className={styles.rowWrap} data-open={menu?.id === `${subject.name}/${sub.name}` || undefined}>
                        <div className={styles.row}>
                          <span className={styles.subName}>{sub.name}</span>
                          <span className={styles.num}><Count kind="new" value={sub.new} /></span>
                          <span className={styles.num}><Count kind="learn" value={sub.learn} /></span>
                          <span className={styles.num}><Count kind="due" value={sub.due} /></span>
                          <span />
                        </div>
                        <button
                          type="button"
                          className={styles.rowMore}
                          aria-label={`${sub.name} options`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.id === `${subject.name}/${sub.name}`}
                          onClick={(e) => toggleMenu(`${subject.name}/${sub.name}`, `${sub.name} options`, e.currentTarget, 'subdeck')}
                        >
                          <Icon name="moreVertical" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {menu && (
        <MenuCard anchor={menu.anchor} label={menu.label} onClose={() => setMenu(null)} className={menu.kind === 'subdeck' ? styles.dropdown : undefined}>
          {menu.kind === 'subject' &&
            SUBJECT_MENU_GROUPS.map((group, i) => (
              <Fragment key={i}>
                {i > 0 && <div className={menuStyles.menuRule} role="separator" />}
                {group.map((item) => (
                  <button key={item.label} type="button" role="menuitem" className={`${menuStyles.menuItem} ${item.danger ? menuStyles.menuDanger : ''}`}>
                    {item.icon && <Icon name={item.icon} />}
                    <span>{item.label}</span>
                  </button>
                ))}
              </Fragment>
            ))}
        </MenuCard>
      )}
    </div>
  );
}
