import { Fragment, useState } from 'react';
import type { Deck } from '../../../core/model';
import { setDeckCollapsed, setDeckColour } from '../../../data/decks';
import { getDeckTreeWithCounts, type DeckTreeWithCounts } from '../../../services/deckService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Count } from '../../components/Count';
import { MenuCard } from '../../components/MenuCard';
import menuStyles from '../../components/MenuCard.module.css';
import { useToast } from '../../components/Toast';
import { DECK_COLOUR_NAMES, deckColour } from '../../deckColour';
import { Icon, type IconName } from '../../icons/icons';
import { Activity } from './Activity';
import { useDeckActions, type DeckHandlers } from './DeckActions';
import { Notch } from './Notch';
import styles from './Today.module.css';

interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect(): void;
}

/** The menu for a deck, in groups with a divider between them. Colour is only offered on top-level decks, as in the Decks screen. */
function deckMenuGroups(deck: Deck, h: DeckHandlers, chooseColour: () => void): MenuItem[][] {
  return [
    [
      { label: 'Study', onSelect: h.study },
      { label: 'Add card here', onSelect: h.addCard },
    ],
    [
      { label: 'Add subdeck', icon: 'newDeck', onSelect: h.addSubdeck },
      { label: 'Rename', icon: 'edit', onSelect: h.rename },
      ...(deck.parentId === null ? [{ label: 'Colour', icon: 'droplet' as const, onSelect: chooseColour }] : []),
      { label: 'Deck options', icon: 'settings', onSelect: h.options },
    ],
    [{ label: 'Delete', icon: 'trash', danger: true, onSelect: () => void h.remove() }],
  ];
}

/** Home screen: the notch, your decks in the central card, and the activity heatmap. */
export function Today() {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, deps.clock.now()), []);
  const actions = useDeckActions();

  // One dropdown at a time, under the three-dot button of the deck it belongs to.
  const [menu, setMenu] = useState<{ deck: Deck; anchor: HTMLElement; kind: 'actions' | 'colour' } | null>(null);
  const toggleMenu = (deck: Deck, anchor: HTMLElement) => setMenu((m) => (m?.deck.id === deck.id ? null : { deck, anchor, kind: 'actions' }));
  const pickColour = (deck: Deck, n: number) =>
    setDeckColour(deps.db, deck.id, n).then(changed, (e: unknown) =>
      toast.show({ message: `Atlas couldn't change the deck: ${e instanceof Error ? e.message : String(e)}` }),
    );

  return (
    <div className={styles.page} data-testid="today-screen">
      <Notch />
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
          {tree?.map((node) => <DeckRow key={node.deck.id} node={node} depth={0} openId={menu?.deck.id ?? null} onMore={toggleMenu} />)}
        </div>
      </section>
      <Activity />
      {menu?.kind === 'actions' && (
        <MenuCard anchor={menu.anchor} label={`${menu.deck.name} options`} onClose={() => setMenu(null)}>
          {deckMenuGroups(menu.deck, actions.deckHandlers(menu.deck), () => setMenu({ ...menu, kind: 'colour' })).map((group, i) => (
            <Fragment key={i}>
              {i > 0 && <div className={menuStyles.menuRule} role="separator" />}
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`${menuStyles.menuItem} ${item.danger ? menuStyles.menuDanger : ''}`}
                  onClick={() => {
                    // Colour swaps this card for the colour card, so only the other items close it.
                    if (item.label !== 'Colour') setMenu(null);
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </Fragment>
          ))}
        </MenuCard>
      )}
      {menu?.kind === 'colour' && (
        <MenuCard anchor={menu.anchor} label="Colour" onClose={() => setMenu(null)}>
          {DECK_COLOUR_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className={menuStyles.menuItem}
              onClick={() => {
                setMenu(null);
                void pickColour(menu.deck, i + 1);
              }}
            >
              <span className={styles.swatch} style={{ background: deckColour(i + 1) }} aria-hidden="true" />
              <span>{name}</span>
            </button>
          ))}
        </MenuCard>
      )}
      {actions.ui}
    </div>
  );
}

/**
 * One deck and, underneath it, its sub-decks. A deck with sub-decks opens and closes when you click it (and stays that way,
 * like in the Decks screen); a deck without any starts a study session.
 */
function DeckRow({ node, depth, openId, onMore }: { node: DeckTreeWithCounts; depth: number; openId: number | null; onMore(deck: Deck, anchor: HTMLElement): void }) {
  const { deps, navigate, changed } = useAtlas();
  const toast = useToast();
  const { deck, counts, children } = node;
  const hasChildren = children.length > 0;

  const toggle = () =>
    setDeckCollapsed(deps.db, deck.id, !deck.collapsed).then(changed, (e: unknown) =>
      toast.show({ message: `Atlas couldn't change the deck: ${e instanceof Error ? e.message : String(e)}` }),
    );

  return (
    <div className={depth === 0 ? styles.group : undefined}>
      <div className={styles.rowWrap} data-open={openId === deck.id || undefined}>
        <button
          type="button"
          className={`${styles.row} ${styles.rowMain}`}
          aria-expanded={hasChildren ? !deck.collapsed : undefined}
          onClick={hasChildren ? toggle : () => navigate({ name: 'study', deckId: deck.id })}
        >
          {depth === 0 ? (
            <span className={styles.subjectName}>
              <span className={styles.bar} style={{ background: deckColour(deck.colour) }} aria-hidden="true" />
              {deck.name}
            </span>
          ) : (
            <span className={styles.subName}>{deck.name}</span>
          )}
          <span className={styles.num}><Count kind="new" value={counts.new} /></span>
          <span className={styles.num}><Count kind="learn" value={counts.learn} /></span>
          <span className={styles.num}><Count kind="due" value={counts.review} /></span>
          <span />
        </button>
        <button
          type="button"
          className={styles.rowMore}
          aria-label={`${deck.name} options`}
          aria-haspopup="menu"
          aria-expanded={openId === deck.id}
          onClick={(e) => onMore(deck, e.currentTarget)}
        >
          <Icon name="moreVertical" />
        </button>
      </div>
      {hasChildren && (
        <div className={styles.subWrap} data-collapsed={deck.collapsed || undefined}>
          <div className={styles.subInner}>
            {children.map((child) => <DeckRow key={child.deck.id} node={child} depth={depth + 1} openId={openId} onMore={onMore} />)}
          </div>
        </div>
      )}
    </div>
  );
}
