import { useState, type ReactNode } from 'react';
import type { Deck } from '../../../core/model';
import { createDeck, deckDeletionSummary, DeckNameError, deleteDeck, renameDeck, setDeckColour } from '../../../data/decks';
import { useAtlas } from '../../app/AtlasContext';
import { Dialog } from '../../components/Dialog';
import { Input } from '../../components/Input';
import { SafetyBackupError } from '../../../services/backupService';
import { Menu, type MenuItem } from '../../components/Menu';
import { useToast } from '../../components/Toast';
import { DECK_COLOUR_NAMES, deckColour } from '../../deckColour';

type Anchor = HTMLElement | { x: number; y: number };
type Open =
  | { kind: 'menu'; deck: Deck; anchor: Anchor }
  | { kind: 'colour'; deck: Deck; anchor: Anchor }
  | { kind: 'name'; title: string; confirm: string; initial: string; save(name: string): Promise<void> }
  | { kind: 'delete'; deck: Deck; text: string }
  | null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function deletionText(name: string, s: { subdecks: number; cards: number }): string {
  const subs = s.subdecks ? ` and its ${plural(s.subdecks, 'subdeck', 'subdecks')}` : '';
  return `Delete ${name}${subs}? This deletes ${plural(s.cards, 'card', 'cards')} and their review history. This can't be undone.`;
}

export interface DeckHandlers {
  study(): void;
  cram(): void;
  addCard(): void;
  rename(): void;
  addSubdeck(): void;
  remove(): Promise<void>;
}

/** The deck menu (spec 10.3) and its dialogs. */
export function useDeckActions(): {
  openMenu(deck: Deck, anchor: Anchor): void;
  deckHandlers(deck: Deck): DeckHandlers;
  newDeck(parentId?: number | null): void;
  ui: ReactNode;
} {
  const { deps, navigate, changed } = useAtlas();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const askName = (title: string, confirm: string, initial: string, save: (n: string) => Promise<void>) => {
    setName(initial);
    setError(null);
    setOpen({ kind: 'name', title, confirm, initial, save });
  };

  const newDeck = (parentId: number | null = null) =>
    askName(parentId === null ? 'New deck' : 'Add subdeck', 'Create deck', '', async (n) => {
      await createDeck(deps.db, { name: n, parentId }, deps.clock.now());
    });

  const failed = (e: unknown) => toast.show({
    message: e instanceof SafetyBackupError ? e.message : `Atlas couldn't change the deck: ${e instanceof Error ? e.message : String(e)}`,
  });

  /** What each deck-menu item does, so a screen can show these in its own style of menu. Colour is left to the screen. */
  const deckHandlers = (deck: Deck): DeckHandlers => ({
    study: () => navigate({ name: 'study', deckId: deck.id }),
    cram: () => navigate({ name: 'cram', deckId: deck.id }),
    addCard: () => navigate({ name: 'add', deckId: deck.id }),
    rename: () => askName('Rename deck', 'Rename', deck.name, (n) => renameDeck(deps.db, deck.id, n)),
    addSubdeck: () => newDeck(deck.id),
    remove: async () => {
      try {
        setOpen({ kind: 'delete', deck, text: deletionText(deck.name, await deckDeletionSummary(deps.db, deck.id)) });
      } catch (e) {
        failed(e);
      }
    },
  });

  const menuItems = (deck: Deck, anchor: Anchor): MenuItem[] => {
    const h = deckHandlers(deck);
    return [
      { label: 'Study', onSelect: h.study },
      { label: 'Add card here', onSelect: h.addCard },
      { label: 'Rename', shortcut: 'F2', onSelect: h.rename },
      { label: 'Add subdeck', onSelect: h.addSubdeck },
      ...(deck.parentId === null ? [{ label: 'Colour', onSelect: () => setOpen({ kind: 'colour', deck, anchor }) }] : []),
      'divider',
      { label: 'Delete', danger: true, onSelect: h.remove },
    ];
  };

  let ui: ReactNode = null;
  if (open?.kind === 'menu') {
    ui = <Menu anchor={open.anchor} label={`${open.deck.name} options`} items={menuItems(open.deck, open.anchor)} onClose={() => setOpen((o) => (o?.kind === 'menu' ? null : o))} />;
  } else if (open?.kind === 'colour') {
    const deck = open.deck;
    ui = (
      <Menu
        anchor={open.anchor}
        label="Colour"
        onClose={() => setOpen((o) => (o?.kind === 'colour' ? null : o))}
        items={DECK_COLOUR_NAMES.map((label, i) => ({
          label,
          swatch: deckColour(i + 1),
          onSelect: () => void setDeckColour(deps.db, deck.id, i + 1).then(changed, failed),
        }))}
      />
    );
  } else if (open?.kind === 'name') {
    const o = open;
    ui = (
      <Dialog
        title={o.title}
        confirmLabel={o.confirm}
        onCancel={() => setOpen(null)}
        onConfirm={async () => {
          try {
            await o.save(name);
            setOpen(null);
            changed();
          } catch (e) {
            if (e instanceof DeckNameError) setError(e.message);
            else failed(e);
          }
        }}
      >
        <Input label="Deck name" value={name} error={error} onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }} />
      </Dialog>
    );
  } else if (open?.kind === 'delete') {
    const deck = open.deck;
    ui = (
      <Dialog
        title={`Delete ${deck.name}?`}
        confirmLabel="Delete deck"
        confirmVariant="danger"
        onCancel={() => setOpen(null)}
        onConfirm={async () => {
          setOpen(null);
          try {
            await deps.backups?.beforeDelete();
            await deleteDeck(deps.db, deck.id);
            toast.show({ message: `Deleted ${deck.name}` });
          } catch (e) {
            failed(e);
          }
          changed();
        }}
      >
        <p style={{ margin: 0 }}>{open.text}</p>
      </Dialog>
    );
  }

  return { openMenu: (deck, anchor) => setOpen({ kind: 'menu', deck, anchor }), deckHandlers, newDeck, ui };
}
