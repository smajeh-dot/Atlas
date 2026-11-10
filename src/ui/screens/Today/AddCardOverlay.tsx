import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardOrdsForNote } from '../../../core/cards';
import { cardDecks, pickCardDeck } from '../../../core/deckChoices';
import { fullName } from '../../../core/deckTree';
import type { BuiltinNoteType, NoteType } from '../../../core/model';
import { createDeck, DeckNameError, listDecks } from '../../../data/decks';
import { listNoteTypes } from '../../../data/noteTypes';
import { addNote, NO_CARDS_MESSAGE, NoCardsError, updateNote } from '../../../services/noteService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { FieldEditor } from '../../editor/FieldEditor';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { MenuCard } from '../../components/MenuCard';
import { useToast } from '../../components/Toast';
import menuStyles from '../../components/MenuCard.module.css';
import { Icon } from '../../icons/icons';
import { trapTab, useOverlayLayer, useRestoreFocus } from '../../components/overlayStack';
import { AddCardPreview } from './AddCardPreview';
import { AddCardToolbar } from './AddCardToolbar';
import { SubjectFields } from './SubjectFields';
import styles from './AddCardOverlay.module.css';

/** The rows of the card type dropdown, top to bottom. */
const TYPE_ROWS = ['Subject', 'Folder', 'Basic', 'Image Occlusion'];
/** The rows that open a card with no card fields, tags or preview (everything but Basic, which is the card that's built). Subject has its own fields; the others are empty. */
const BLANK_VIEWS = ['Subject', 'Folder', 'Image Occlusion'];
const TYPES: BuiltinNoteType[] = ['basic', 'basic_reversed', 'basic_typein', 'cloze'];

/** The existing card the overlay is editing: Study passes this in when its Edit card icon is used. */
export interface EditingCard {
  noteType: NoteType;
  fields: string[];
  deckId: number;
  noteId: number;
  /** Kept as they are: the edit view has no tags field, and saving replaces a note's tags with the ones given. */
  tags: string[];
}

/**
 * A large card in the middle of the window over the Home screen, with everything around it darkened.
 * The X, Esc or a click outside the card closes it. Along the top: the card type, then the deck it's being added to
 * (the type opens a dropdown of Subject, Folder, Basic and Image Occlusion, and each row opens its own version of this card: Basic is the one described below; Subject has a Name and a Colour, and Add makes a subject from them; Folder and Image Occlusion are blank for now, with only these two buttons, Add, Close and the X; the deck opens a dropdown of your decks),
 * and in the corner the close button. Under those, a row of placeholder text-editing buttons, then a field for each side of the card
 * (Front and Back for Basic) in the left half, and a live preview card in the right. Along the bottom: a tag icon on the left with a field beside it (a plain icon, not a button; the field is left out when editing a card), and Add and Close on
 * the right. Add saves the card in the chosen deck, empties the fields, puts the cursor back on the first one and leaves the card open for the next;
 * if the card would be empty it says why and keeps what was typed. The deck and card type used are remembered for next time.
 * The tags field isn't saved yet, so a card is added without tags. On the Subject view Add makes a new top-level deck with that name and colour (a subject is a
 * top-level deck that has decks inside it, so this one is a deck until you add sub-decks to it), empties the name and leaves the card open for the next; it says what's
 * wrong with the name under the Name box and makes nothing if it's empty or already used. Add does nothing on the Folder and Image Occlusion views.
 * `deckId` is the deck it was opened for (from a deck's menu), if any.
 *
 * With `editing` set (opened from Study's Edit card icon) it is about one existing card: the fields start filled in with that card's text, the preview
 * shows it, the card type is the card's own, and there is no deck button because the card stays in its deck. Add then saves the changes to that
 * card's note (keeping its tags and its review schedule), calls `onSaved` and leaves the overlay to the caller to close; emptying the first field says why and saves nothing.
 */
export function AddCardOverlay({ deckId, editing, onSaved, onClose }: {
  deckId?: number;
  editing?: EditingCard;
  /** The edit was saved; the caller reloads the card and closes the overlay. */
  onSaved?(): void;
  onClose(): void;
}) {
  const { deps, settings, saveSettings, changed } = useAtlas();
  const toast = useToast();
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
  // What's been typed and picked on the Subject card: its name, and its colour as a deck colour number (Green to begin with). And what's wrong with the name, if anything.
  const [subjectName, setSubjectName] = useState('');
  const [subjectColour, setSubjectColour] = useState(1);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>(editing?.fields ?? []);
  // The type you used last (else Basic). The deck is the one picked here, else the one this was opened for, else the one you used last,
  // else the first deck. Subjects aren't decks, so a subject stands for the first deck inside it.
  const basic = data?.types.find((t) => t.builtin === 'basic');
  const noteType = editing?.noteType ?? (data && ((view === 'Basic' ? basic : undefined) ?? data.types.find((t) => t.id === settings.lastNoteTypeId) ?? basic ?? data.types[0]));
  // Subject, Folder and Image Occlusion have no card fields, toolbar, tags or preview: only the type and deck buttons, Add, Close and the X
  // (and the Subject card's own fields). Add makes a subject on the first, and saves nothing on the others.
  const blank = !editing && view !== null && BLANK_VIEWS.includes(view);
  const typeName = blank ? view : noteType?.name;
  const deck = data && pickCardDeck(data.decks, [chosenDeck, editing?.deckId ?? deckId, settings.lastDeckId]);
  const card = useRef<HTMLDivElement>(null);
  const isTop = useOverlayLayer();
  useRestoreFocus();
  useEffect(() => {
    if (!card.current?.contains(document.activeElement)) card.current?.focus();
  }, []);

  // The first field's editor, to put the cursor back on it after a card is added. And a flag (not state, which lags a click behind)
  // so a double click on Add saves once.
  const firstField = useRef<Editor | null>(null);
  const subjectNameInput = useRef<HTMLInputElement | null>(null);
  const adding = useRef(false);
  // Makes the subject on the Subject card: a top-level deck with the name and colour. Like a card, it empties the name and puts the cursor back on it.
  const addSubject = async () => {
    if (!subjectName.trim()) {
      setSubjectError('Give the subject a name.');
      return;
    }
    adding.current = true;
    try {
      await createDeck(deps.db, { name: subjectName, colour: subjectColour }, deps.clock.now());
    } catch (e) {
      if (e instanceof DeckNameError) setSubjectError(e.message);
      else toast.show({ message: `Atlas couldn't add that subject: ${e instanceof Error ? e.message : String(e)}` });
      return;
    } finally {
      adding.current = false;
    }
    changed();
    setSubjectName('');
    subjectNameInput.current?.focus();
  };
  const add = async () => {
    if (adding.current) return;
    // The other views hide fields that may still hold what was typed, so they save nothing.
    if (blank) {
      if (view === 'Subject') await addSubject();
      return;
    }
    if (!noteType || !deck) return;
    const values = noteType.fields.map((_, i) => fields[i] ?? '');
    adding.current = true;
    try {
      if (editing) {
        if (!cardOrdsForNote(noteType, values).length) throw new NoCardsError(NO_CARDS_MESSAGE);
        await updateNote(deps, editing.noteId, { fields: values, tags: editing.tags });
      } else {
        await addNote(deps, { noteTypeId: noteType.id, deckId: deck.id, fields: values, tags: [] });
      }
    } catch (e) {
      toast.show({ message: e instanceof NoCardsError ? e.message : `Atlas couldn't ${editing ? 'save' : 'add'} that card: ${e instanceof Error ? e.message : String(e)}` });
      return;
    } finally {
      adding.current = false;
    }
    changed();
    if (editing) {
      onSaved?.();
      return;
    }
    setFields([]);
    firstField.current?.commands.focus('end');
    // Remembering the deck and type is a convenience; the card is already saved, so a failure here isn't worth interrupting for.
    saveSettings({ lastDeckId: deck.id, lastNoteTypeId: noteType.id }).catch(() => {});
  };

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
                aria-label={`Deck: ${fullName(data.decks, deck.id, ' · ')}`}
                aria-haspopup="menu"
                aria-expanded={deckMenu !== null}
                onClick={(e) => {
                  setTypeMenu(null);
                  setDeckMenu(deckMenu ? null : e.currentTarget);
                }}
              >
                {fullName(data.decks, deck.id, ' · ')}
              </button>
            )}
          </div>
        )}
        {data && noteType && deck && !blank && <AddCardToolbar />}
        {data && noteType && deck && (
          <div className={styles.body}>
            {blank && view === 'Subject' ? (
              <SubjectFields
                name={subjectName}
                colour={subjectColour}
                error={subjectError}
                nameRef={subjectNameInput}
                onName={(n) => {
                  setSubjectName(n);
                  setSubjectError(null);
                }}
                onColour={setSubjectColour}
              />
            ) : blank ? (
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
                      editorRef={(e) => {
                        if (i === 0) firstField.current = e;
                      }}
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
                <Button
                  variant="primary"
                  size="sm"
                  className={styles.add}
                  onClick={(e) => {
                    // The second click of a double click on the Subject card would find the name already emptied and complain about it.
                    if (blank && e.detail > 1) return;
                    void add();
                  }}
                >
                  Add
                </Button>
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
