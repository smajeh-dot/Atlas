import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fullName, treeOrder } from '../../../core/deckTree';
import type { BuiltinNoteType } from '../../../core/model';
import { listDecks } from '../../../data/decks';
import { listNoteTypes } from '../../../data/noteTypes';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Icon } from '../../icons/icons';
import { trapTab, useOverlayLayer, useRestoreFocus } from '../../components/overlayStack';
import styles from './AddCardOverlay.module.css';

const TYPES: BuiltinNoteType[] = ['basic', 'basic_reversed', 'basic_typein', 'cloze'];

/**
 * A large card in the middle of the window over the Home screen, with everything around it darkened.
 * The X, Esc or a click outside the card closes it. Along the top: the card type, then the deck it's being added to
 * (both just show the current choice for now), and in the corner the triple-dot button, which doesn't do anything yet. `deckId` is the deck it was opened for (from a deck's menu), if any.
 */
export function AddCardOverlay({ deckId, onClose }: { deckId?: number; onClose(): void }) {
  const { deps, settings } = useAtlas();
  const { data } = useData(async () => ({
    decks: await listDecks(deps.db),
    types: (await listNoteTypes(deps.db)).filter((t) => t.builtin && TYPES.includes(t.builtin)),
  }), []);
  // The same defaults the old Add card screen used: the type you used last (else Basic), and the deck you opened this from,
  // else the one you used last, else the first deck.
  const noteType = data && (data.types.find((t) => t.id === settings.lastNoteTypeId) ?? data.types.find((t) => t.builtin === 'basic') ?? data.types[0]);
  const deck = data && ([deckId, settings.lastDeckId].find((id) => id != null && data.decks.some((d) => d.id === id)) ?? treeOrder(data.decks)[0]);
  const card = useRef<HTMLDivElement>(null);
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => card.current?.focus(), []);

  return createPortal(
    <div
      className={styles.overlay}
      data-testid="add-card-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="Add card"
        data-deck-id={deckId}
        tabIndex={-1}
        className={styles.card}
        onKeyDown={(e) => {
          if (!isTop()) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else trapTab(e, card.current);
        }}
      >
        {data && noteType && deck != null && (
          <div className={styles.selectors}>
            <button type="button" className={styles.selector} aria-label={`Card type: ${noteType.name}`}>{noteType.name}</button>
            <button type="button" className={styles.selector} aria-label={`Deck: ${fullName(data.decks, deck)}`}>{fullName(data.decks, deck)}</button>
          </div>
        )}
        <div className={styles.corner}>
          <button type="button" className={styles.cornerButton} aria-label="More options" aria-haspopup="menu">
            <Icon name="moreVertical" />
          </button>
          <button type="button" className={styles.cornerButton} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
