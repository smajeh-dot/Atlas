import { useState } from 'react';
import { fullName, treeOrder } from '../../../core/deckTree';
import { getCard, setCardDeck } from '../../../data/cards';
import { listDecks } from '../../../data/decks';
import { getNoteType } from '../../../data/noteTypes';
import { getNote, listTags } from '../../../data/notes';
import { updateNote } from '../../../services/noteService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { NoteEditor } from '../../editor/NoteEditor';
import { matchKey } from '../../keys';
import styles from './Editor.module.css';

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Edits the note behind a card from Study (and Browse later). The type is fixed; the deck moves this card only. */
export function EditCardSheet({ cardId, onClose }: { cardId: number; onClose(saved: boolean): void }) {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const { data } = useData(async () => {
    const card = await getCard(deps.db, cardId);
    const note = await getNote(deps.db, card.noteId);
    return { card, note, noteType: await getNoteType(deps.db, note.noteTypeId), decks: await listDecks(deps.db), tags: await listTags(deps.db) };
  }, [cardId]);
  const [fields, setFields] = useState<string[] | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [deck, setDeck] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!data) return null;
  const { card, note, noteType, decks } = data;
  const nowFields = fields ?? note.fields;
  const nowTags = tags ?? note.tags;
  const nowDeck = deck ?? card.deckId;
  const dirty = !same(nowFields, note.fields) || !same(nowTags, note.tags) || nowDeck !== card.deckId;

  const requestClose = () => (dirty ? setConfirming(true) : onClose(false));
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateNote(deps, note.id, { fields: noteType.fields.map((_, i) => nowFields[i] ?? ''), tags: nowTags });
      if (nowDeck !== card.deckId) await setCardDeck(deps.db, card.id, nowDeck, deps.clock.now());
      changed();
      onClose(true);
    } catch (e) {
      toast.show({ message: `Atlas couldn't save that card: ${e instanceof Error ? e.message : String(e)}` });
      setSaving(false);
    }
  };
  const depth = (id: number) => fullName(decks, id).split(' › ').length - 1;

  return (
    <>
      <Sheet
        title="Edit card"
        onRequestClose={requestClose}
        footer={
          <>
            <Button variant="secondary" kbd="Esc" onClick={requestClose}>Cancel</Button>
            <Button variant="primary" kbd="Ctrl+Enter" disabled={saving} onClick={() => void save()}>Save</Button>
          </>
        }
      >
        <div
          className={styles.sheetBody}
          onKeyDown={(e) => {
            // A field editor already handled Ctrl+Enter itself (and marked the key as used).
            if (!e.defaultPrevented && matchKey(e.nativeEvent, 'Ctrl+Enter')) {
              e.preventDefault();
              void save();
            }
          }}
        >
          <div className={styles.selectors}>
            <div className={styles.fixedType}>
              <span className={styles.label}>Type</span>
              <span>{noteType.name}</span>
            </div>
            <Select<number> label="Deck" filterable value={nowDeck} onChange={setDeck}
              options={treeOrder(decks).map((id) => ({ value: id, label: fullName(decks, id), depth: depth(id) }))} />
          </div>
          <NoteEditor
            noteType={noteType}
            fields={nowFields}
            onFields={setFields}
            tags={nowTags}
            onTags={setTags}
            tagSuggestions={data.tags}
            deckFullName={fullName(decks, nowDeck, '::')}
            autoFocus
            onSubmit={() => void save()}
          />
        </div>
      </Sheet>
      {confirming && (
        <Dialog title="Discard changes?" confirmLabel="Discard" confirmVariant="danger" cancelLabel="Keep editing"
          onCancel={() => setConfirming(false)} onConfirm={() => onClose(false)}>
          <p className={styles.dialogText}>Your edits to this card haven't been saved.</p>
        </Dialog>
      )}
    </>
  );
}
