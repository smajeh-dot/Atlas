import type { Deck } from '../../../core/model';
import { setDeckCollapsed } from '../../../data/decks';
import { getDeckTreeWithCounts, type DeckTreeWithCounts } from '../../../services/deckService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Count } from '../../components/Count';
import { useToast } from '../../components/Toast';
import { deckColour } from '../../deckColour';
import { Icon } from '../../icons/icons';
import { Activity } from './Activity';
import { AddCardOverlay } from './AddCardOverlay';
import { useDeckMenu } from './DeckMenu';
import { Notch } from './Notch';
import styles from './Today.module.css';

/**
 * Home screen: the notch, your decks in the central card, and the activity heatmap, all centred in the window.
 * The Settings button sits in the top-right corner.
 * With `addCard` set, the Add card overlay is open on top of it (the 'add' route is Home with that overlay showing).
 */
export function Today({ addCard }: { addCard?: { deckId?: number } }) {
  const { deps, navigate } = useAtlas();
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, deps.clock.now()), []);
  const menu = useDeckMenu();

  return (
    <div className={styles.page} data-testid="today-screen">
      <Notch />
      <button
        type="button"
        className={`${styles.iconButton} ${styles.settingsButton}`}
        aria-label="Settings"
        title="Settings (Ctrl+,)"
        onClick={() => navigate({ name: 'settings' })}
      >
        <Icon name="settings" />
      </button>
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
          {tree?.map((node) => <DeckRow key={node.deck.id} node={node} depth={0} openId={menu.openId} onMore={menu.toggle} />)}
        </div>
      </section>
      <Activity />
      {menu.ui}
      {addCard && <AddCardOverlay deckId={addCard.deckId} onClose={() => navigate({ name: 'today' })} />}
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
