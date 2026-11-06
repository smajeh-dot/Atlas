import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardDecks, pickCardDeck } from '../../../core/deckChoices';
import { fullName } from '../../../core/deckTree';
import type { BuiltinNoteType, NoteType } from '../../../core/model';
import { listDecks } from '../../../data/decks';
import { listNoteTypes } from '../../../data/noteTypes';
import { useAtlas, useData } from '../../app/AtlasContext';
import { FieldEditor } from '../../editor/FieldEditor';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { MenuCard } from '../../components/MenuCard';
import menuStyles from '../../components/MenuCard.module.css';
import { Icon } from '../../icons/icons';
import { trapTab, useOverlayLayer, useRestoreFocus } from '../../components/overlayStack';
import { AddCardPreview } from './AddCardPreview';
import { AddCardToolbar } from './AddCardToolbar';
import styles from './AddCardOverlay.module.css';

/** The rows of the card type dropdown, top to bottom. They don't do anything yet. */
const TYPE_ROWS = ['Subject', 'Folder', 'Basic', 'Image Occlusion'];
/** The rows that open a blank card (everything but Basic, which is the card that's built). */
const BLANK_VIEWS = ['Subject', 'Folder', 'Image Occlusion'];
const TYPES: BuiltinNoteType[] = ['basic', 'basic_reversed', 'basic_typein', 'cloze'];

/**
 * A large card in the middle of the window over the Home screen, with everything around it darkened.
 * The X, Esc or a click outside the card closes it. Along the top: the card type, then the deck it's being added to
 * (the type opens a dropdown of Subject, Folder, Basic and Image Occlusion, and each row opens its own version of this card: Basic is the one described below, the others are blank for now, with only these two buttons, Add, Close and the X; the deck opens a dropdown of your decks),
 * and in the corner the close button. Under those, a row of placeholder text-editing buttons, then a field for each side of the card
 * (Front and Back for Basic) in the left half, and a live preview card in the right. Along the bottom: a tag icon on the left with a field beside it (a plain icon, not a button; the field is left out when editing a card), and Add (nothing yet) and Close on
 * the right. What's typed is only kept while the card is open: nothing saves a card yet. `deckId` is the deck it was opened for (from a deck's menu), if any.
 *
 * With `editing` set (opened from Study's Edit card icon) it is about one existing card: the fields start filled in with that card's text, the preview
 * shows it, the card type is the card's own, and there is no deck button because the card stays in its deck.
 */
export function AddCardOverlay({ deckId, editing, onClose }: {
  deckId?: number;
  editing?: { noteType: NoteType; fields: string[]; deckId: number };
  onClose(): void;
}) {
  const { deps, settings } = useAtlas();
  const { data } = useData(async () => ({
    decks: await listDecks(deps.db),
    types: (await listNoteTypes(deps.db)).filter((t) => t.builtin && TYPES.includes(t.builtin)),
  }), []);
  // The dropdown under the deck button: the button it hangs from while open, else null. And the deck picked from it, if any.
  const [deckMenu, setDeckMenu] = useState<HTMLElement | null>(null);
  // The dropdown under the card type button, the same way. It is blank apart from its four rows for now.
  const [typeMenu, setTypeMenu] = useState<HTMLElement | null>(null);
  // The row picked from the card type dropdown, else null (the card as it opened: the type you used last, Basic to begin with).
  const [view, setView] = useState<string | null>(null);
  const [chosenDeck, setChosenDeck] = useState<number | null>(null);
  // What's been typed into each field, in the order of the card type's fields.
  // What's been typed into the tags field (nothing uses it yet).
  const [tagText, setTagText] = useState('');
  const [fields, setFields] = useState<string[]>(editing?.fields ?? []);
  // The type you used last (else Basic). The deck is the one picked here, else the one this was opened for, else the one you used last,
  // else the first deck. Subjects aren't decks, so a subject stands for the first deck inside it.
  const basic = data?.types.find((t) => t.builtin === 'basic');
  const noteType = editing?.noteType ?? (data && ((view === 'Basic' ? basic : undefined) ?? data.types.find((t) => t.id === settings.lastNoteTypeId) ?? basic ?? data.types[0]));
  // Subject, Folder and Image Occlusion are blank cards for now: only the type and deck buttons, Add, Close and the X.
  const blank = !editing && view !== null && BLANK_VIEWS.includes(view);
  const typeName = blank ? view : noteType?.name;
  const deck = data && pickCardDeck(data.decks, [chosenDeck, editing?.deckId ?? deckId, settings.lastDeckId]);
  const card = useRef<HTMLDivElement>(null);
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => {
    if (!card.current?.contains(document.activeElement)) card.current?.focus();
  }, []);

  return createPortal(
    <div
      className={styles.overlay}
      data-testid="add-card-overlay"
      onMouseDown={(e) => {
        // With the dropdown open, a click outside closes only the dropdown.
        if (e.target === e.currentTarget && isTop()) onClose();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit card' : 'Add card'}
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
        {data && noteType && deck && (
          <div className={styles.selectors}>
            {editing ? (
              <button type="button" className={styles.selector} aria-label={`Card type: ${noteType.name}`}>{noteType.name}</button>
            ) : (
              <button
                type="button"
                className={styles.selector}
                aria-label={`Card type: ${typeName}`}
                aria-haspopup="menu"
                aria-expanded={typeMenu !== null}
                onClick={(e) => {
                  setDeckMenu(null);
                  setTypeMenu(typeMenu ? null : e.currentTarget);
                }}
              >
                {typeName}
              </button>
            )}
            {!editing && (
              <button
                type="button"
                className={styles.selector}
                aria-label={`Deck: ${fullName(data.decks, deck.id)}`}
                aria-haspopup="menu"
                aria-expanded={deckMenu !== null}
                onClick={(e) => {
                  setTypeMenu(null);
                  setDeckMenu(deckMenu ? null : e.currentTarget);
                }}
              >
                {fullName(data.decks, deck.id)}
              </button>
            )}
          </div>
        )}
        {data && noteType && deck && !blank && <AddCardToolbar />}
        {data && noteType && deck && (
          <div className={styles.body}>
            {blank ? (
              <div className={styles.blank} data-testid="add-card-blank" />
            ) : (
              <div className={styles.halves}>
                <div className={styles.fields}>
                  {noteType.fields.map((f, i) => (
                    <FieldEditor
                      key={`${noteType.id}-${f.name}`}
                      label={f.name}
                      value={fields[i] ?? ''}
                      autoFocus={i === 0}
                      mediaUrl={deps.media.url}
                      getAllText={() => fields.join('\n')}
                      // Pictures would be saved to your media folder for a card that can't be saved yet, so they wait.
                      onImage={async () => {
                        throw new Error("Pictures can't be added to a card here yet.");
                      }}
                      onChange={(html) =>
                        setFields((prev) => {
                          const next = [...prev];
                          while (next.length < noteType.fields.length) next.push('');
                          next[i] = html;
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
                <div className={styles.right} data-testid="add-card-right">
                  <AddCardPreview noteType={noteType} fields={fields} deckFullName={fullName(data.decks, deck.id, '::')} />
                </div>
              </div>
            )}
            <div className={styles.footer} data-testid="add-card-footer">
              {!blank && (
                <div className={styles.tags}>
                  <span className={styles.tagIcon} data-testid="add-card-tag-icon" aria-hidden="true">
                    <Icon name="tag" />
                  </span>
                  {!editing && (
                    <div className={styles.tagField}>
                      <Input label="Tags" hideLabel placeholder="Add tags" value={tagText} onChange={(e) => setTagText(e.target.value)} />
                    </div>
                  )}
                </div>
              )}
              <div className={styles.actions}>
                <Button variant="primary" size="sm" className={styles.add}>Add</Button>
                <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
              </div>
            </div>
          </div>
        )}
        <div className={styles.corner} data-testid="add-card-corner">
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      {typeMenu && (
        <MenuCard anchor={typeMenu} label="Card type" onClose={() => setTypeMenu(null)} className={styles.typeDropdown}>
          {TYPE_ROWS.map((name) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className={menuStyles.menuItem}
              onClick={() => {
                setView(name);
                setTypeMenu(null);
                typeMenu.focus();
              }}
            >
              {name}
            </button>
          ))}
        </MenuCard>
      )}
      {deckMenu && data && deck && (
        <MenuCard anchor={deckMenu} label="Deck" onClose={() => setDeckMenu(null)} className={styles.dropdown}>
          {cardDecks(data.decks).map((d) => (
            <button
              key={d.id}
              type="button"
              role="menuitemradio"
              aria-checked={d.id === deck.id}
              aria-label={fullName(data.decks, d.id)}
              title={fullName(data.decks, d.id)}
              className={`${menuStyles.menuItem} ${styles.deckItem}`}
              data-selected={d.id === deck.id || undefined}
              onClick={() => {
                setChosenDeck(d.id);
                setDeckMenu(null);
                deckMenu.focus();
              }}
            >
              <span className={styles.deckName}>{d.name}</span>
            </button>
          ))}
        </MenuCard>
      )}
    </div>,
    document.body,
  );
}
