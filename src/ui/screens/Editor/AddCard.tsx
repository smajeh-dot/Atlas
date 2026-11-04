import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { fullName } from '../../../core/deckTree';
import { treeOrder } from '../../../core/deckTree';
import type { BuiltinNoteType } from '../../../core/model';
import { listDecks } from '../../../data/decks';
import { listNoteTypes } from '../../../data/noteTypes';
import { listTags } from '../../../data/notes';
import { addNote, findDuplicateDeck, NoCardsError } from '../../../services/noteService';
import { undoIfLatest } from '../../../services/undo';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { NoteEditor } from '../../editor/NoteEditor';
import { Icon } from '../../icons/icons';
import { useHotkeys } from '../../keys';
import styles from './Editor.module.css';

const TYPES: BuiltinNoteType[] = ['basic', 'basic_reversed', 'basic_typein', 'cloze'];
const DUPLICATE_DELAY_MS = 300;

export function AddCard({ deckId }: { deckId?: number }) {
  const { deps, settings, saveSettings, changed } = useAtlas();
  const toast = useToast();
  const { data } = useData(async () => ({
    decks: await listDecks(deps.db),
    types: (await listNoteTypes(deps.db)).filter((t) => t.builtin && TYPES.includes(t.builtin)),
    tags: await listTags(deps.db),
  }), []);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [chosenDeck, setChosenDeck] = useState<number | null>(deckId ?? null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [added, setAdded] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<number | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const firstField = useRef<Editor | null>(null);

  const types = data?.types ?? [];
  const decks = data?.decks ?? [];
  const noteType = types.find((t) => t.id === (typeId ?? settings.lastNoteTypeId)) ?? types.find((t) => t.builtin === 'basic') ?? types[0];
  const deckIds = decks.map((d) => d.id);
  const deck = [chosenDeck, settings.lastDeckId].find((id) => id !== null && deckIds.includes(id)) ?? treeOrder(decks)[0] ?? null;

  // Duplicates: same note type and first field (spec 10.5), checked once typing pauses.
  useEffect(() => {
    if (!noteType || !fields[0]) {
      setDuplicate(undefined);
      return;
    }
    const t = setTimeout(() => {
      findDuplicateDeck(deps.db, noteType.id, fields[0]!).then(setDuplicate, () => setDuplicate(undefined));
    }, DUPLICATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [fields[0], noteType?.id]);

  const add = async () => {
    if (!noteType || deck === null || saving) return;
    setSaving(true);
    try {
      const { cardIds, undoEntry } = await addNote(deps, { noteTypeId: noteType.id, deckId: deck, fields: noteType.fields.map((_, i) => fields[i] ?? ''), tags });
      setAdded((n) => n + cardIds.length);
      setFields([]);
      setProblem(null);
      setDuplicate(undefined);
      changed();
      const leaf = decks.find((d) => d.id === deck)?.name ?? '';
      toast.show({
        message: `Added to ${leaf}`,
        action: {
          label: 'Undo',
          onClick: () => void undoIfLatest(deps.db, deps.undo, undoEntry).then(
            (label) => {
              if (!label) return;
              setAdded((n) => Math.max(0, n - cardIds.length));
              toast.show({ message: `Undid: ${label}` });
              changed();
            },
            (e: unknown) => toast.show({ message: `Atlas couldn't undo that: ${e instanceof Error ? e.message : String(e)}` }),
          ),
        },
      });
      firstField.current?.commands.focus();
    } catch (e) {
      if (e instanceof NoCardsError) setProblem(e.message);
      else toast.show({ message: `Atlas couldn't save that card: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  useHotkeys({ 'Ctrl+Enter': () => void add() }, { allowInInputs: ['Ctrl+Enter'] });

  if (!noteType || deck === null) return null;
  const deckFullName = fullName(decks, deck, '::');
  const depth = (id: number) => fullName(decks, id).split(' › ').length - 1;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Add card</h1>
        {added > 0 && <span className={styles.counter}>{added} {added === 1 ? 'card' : 'cards'} added this session</span>}
      </header>
      <NoteEditor
        key={noteType.id}
        noteType={noteType}
        fields={fields}
        onFields={(f) => {
          setFields(f);
          setProblem(null);
        }}
        tags={tags}
        onTags={setTags}
        tagSuggestions={data?.tags ?? []}
        deckFullName={deckFullName}
        firstFieldRef={firstField}
        header={(
          <div className={styles.selectors}>
            <Select label="Type" value={noteType.id} options={types.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(id) => {
                setTypeId(id);
                setProblem(null);
                void saveSettings({ lastNoteTypeId: id });
              }} />
            <Select label="Deck" filterable value={deck} options={treeOrder(decks).map((id) => ({ value: id, label: fullName(decks, id), depth: depth(id) }))}
              onChange={(id) => {
                setChosenDeck(id);
                void saveSettings({ lastDeckId: id });
              }} />
          </div>
        )}
        autoFocus
        onSubmit={() => void add()}
      />
      <footer className={styles.footer}>
        <div className={styles.status} aria-live="polite">
          {problem ? (
            <span className={styles.problem}>{problem}</span>
          ) : duplicate === null ? (
            <span className={styles.ok}><Icon name="check" /> No duplicates in this deck</span>
          ) : duplicate !== undefined ? (
            <span className={styles.warning}><Icon name="warning" /> Possible duplicate in {fullName(decks, duplicate)}</span>
          ) : null}
        </div>
        <div role="group" aria-label="Note actions" className={styles.actions}>
          <Button variant="secondary" onClick={() => {
            setFields([]);
            setProblem(null);
            firstField.current?.commands.focus();
          }}>Clear</Button>
          <Button variant="primary" kbd="Ctrl+Enter" disabled={saving} onClick={() => void add()}>Add card</Button>
        </div>
      </footer>
    </div>
  );
}
