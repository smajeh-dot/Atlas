import { useEffect, useRef, useState } from 'react';
import { DeckMoveError, DeckNameError, placeDeck, renameDeck, setDeckCollapsed } from '../../../data/decks';
import type { DeckTreeWithCounts } from '../../../services/deckService';
import { useAtlas } from '../../app/AtlasContext';
import { DeckRow } from '../../components/DeckRow';
import { Input } from '../../components/Input';
import { useToast } from '../../components/Toast';
import { useHotkeys } from '../../keys';
import { useDeckActions } from '../Today/DeckActions';
import { visibleRows } from '../Today/flatten';
import styles from './Decks.module.css';

type Zone = 'before' | 'after' | 'inside';

function index(tree: DeckTreeWithCounts[]) {
  const byId = new Map<number, DeckTreeWithCounts>();
  const children = new Map<number | null, DeckTreeWithCounts[]>([[null, tree]]);
  const walk = (nodes: DeckTreeWithCounts[]) => {
    for (const n of nodes) {
      byId.set(n.deck.id, n);
      children.set(n.deck.id, n.children);
      walk(n.children);
    }
  };
  walk(tree);
  return { byId, children };
}

/** Full deck tree for reorganising: drag to move, Alt+arrows to move by keyboard, F2 to rename. */
export function DeckTree({ tree, selected, onSelect }: { tree: DeckTreeWithCounts[]; selected: number | null; onSelect(id: number): void }) {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const actions = useDeckActions();
  const ref = useRef<HTMLDivElement>(null);
  const dragged = useRef<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: number; zone: Zone } | null>(null);
  const rows = visibleRows(tree);
  const at = rows.findIndex((r) => r.node.deck.id === selected);
  const { byId, children } = index(tree);

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const move = async (id: number, parentId: number | null, i: number) => {
    try {
      await placeDeck(deps.db, id, parentId, i);
      changed();
    } catch (e) {
      toast.show({ message: e instanceof DeckMoveError || e instanceof DeckNameError ? e.message : `Atlas couldn't move the deck: ${String(e)}` });
    }
  };

  const siblingsOf = (id: number) => {
    const node = byId.get(id)!;
    const list = children.get(node.deck.parentId) ?? [];
    return { node, list, i: list.findIndex((n) => n.deck.id === id) };
  };

  const startRename = (id: number) => {
    setName(byId.get(id)?.deck.name ?? '');
    setError(null);
    setRenaming(id);
  };

  const saveRename = async () => {
    if (renaming === null) return;
    try {
      await renameDeck(deps.db, renaming, name);
      setRenaming(null);
      changed();
      ref.current?.focus();
    } catch (e) {
      setError(e instanceof DeckNameError ? e.message : String(e));
    }
  };

  const inTree = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !t || t === document.body || t.tagName === 'MAIN' || ref.current?.contains(t) === true;
  };

  useHotkeys({
    ArrowDown: (e) => (inTree(e) && rows.length ? onSelect(rows[Math.min(rows.length - 1, at + 1)]!.node.deck.id) : false),
    ArrowUp: (e) => (inTree(e) && rows.length ? onSelect(rows[Math.max(0, at - 1)]!.node.deck.id) : false),
    ArrowLeft: (e) => {
      const n = selected !== null ? byId.get(selected) : undefined;
      if (!inTree(e) || !n) return false;
      if (n.children.length && !n.deck.collapsed) void setDeckCollapsed(deps.db, n.deck.id, true).then(changed);
      else if (n.deck.parentId !== null) onSelect(n.deck.parentId);
    },
    ArrowRight: (e) => {
      const n = selected !== null ? byId.get(selected) : undefined;
      if (!inTree(e) || !n) return false;
      if (n.children.length && n.deck.collapsed) void setDeckCollapsed(deps.db, n.deck.id, false).then(changed);
    },
    F2: (e) => (inTree(e) && selected !== null ? startRename(selected) : false),
    'Alt+ArrowUp': (e) => {
      if (!inTree(e) || selected === null) return false;
      const { node, i } = siblingsOf(selected);
      if (i > 0) void move(selected, node.deck.parentId, i - 1);
    },
    'Alt+ArrowDown': (e) => {
      if (!inTree(e) || selected === null) return false;
      const { node, list, i } = siblingsOf(selected);
      if (i < list.length - 1) void move(selected, node.deck.parentId, i + 1);
    },
    'Alt+ArrowRight': (e) => {
      if (!inTree(e) || selected === null) return false;
      const { list, i } = siblingsOf(selected);
      const prev = list[i - 1];
      if (prev) void move(selected, prev.deck.id, prev.children.length);
    },
    'Alt+ArrowLeft': (e) => {
      if (!inTree(e) || selected === null) return false;
      const parentId = byId.get(selected)!.deck.parentId;
      if (parentId === null) return;
      const { node: parent, i } = siblingsOf(parentId);
      void move(selected, parent.deck.parentId, i + 1);
    },
    ContextMenu: () => openMenu(),
    'Shift+F10': () => openMenu(),
  });

  function openMenu() {
    const el = selected !== null ? document.getElementById(`decks-row-${selected}`) : null;
    if (!el || selected === null) return false;
    actions.openMenu(byId.get(selected)!.deck, el);
  }

  const zoneOf = (e: React.DragEvent<HTMLElement>): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    return y < r.height / 3 ? 'before' : y > (2 * r.height) / 3 ? 'after' : 'inside';
  };

  const drop = (targetId: number, zone: Zone) => {
    const id = dragged.current;
    dragged.current = null;
    setDropHint(null);
    if (id === null || id === targetId) return;
    if (zone === 'inside') {
      const kids = (children.get(targetId) ?? []).filter((n) => n.deck.id !== id);
      void move(id, targetId, kids.length);
      return;
    }
    const target = byId.get(targetId)!;
    const list = (children.get(target.deck.parentId) ?? []).filter((n) => n.deck.id !== id);
    const i = list.findIndex((n) => n.deck.id === targetId);
    void move(id, target.deck.parentId, zone === 'before' ? i : i + 1);
  };

  return (
    <>
      <div
        ref={ref}
        role="tree"
        aria-label="All decks"
        tabIndex={0}
        aria-activedescendant={selected !== null ? `decks-row-${selected}` : undefined}
        className={styles.tree}
      >
        {rows.map(({ node, depth }) => (
          <DeckRow
            key={node.deck.id}
            id={`decks-row-${node.deck.id}`}
            node={node}
            depth={depth}
            selected={node.deck.id === selected}
            showStudy={false}
            draggable={renaming !== node.deck.id}
            data-drop={dropHint?.id === node.deck.id ? dropHint.zone : undefined}
            onDragStart={(e) => {
              dragged.current = node.deck.id;
              e.dataTransfer?.setData('text/plain', String(node.deck.id));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropHint({ id: node.deck.id, zone: zoneOf(e) });
            }}
            onDragLeave={() => setDropHint(null)}
            onDrop={(e) => {
              e.preventDefault();
              drop(node.deck.id, zoneOf(e));
            }}
            dragHandle={<span className={styles.handle} aria-hidden="true" />}
            onSelect={() => onSelect(node.deck.id)}
            onActivate={() => startRename(node.deck.id)}
            onToggle={() => void setDeckCollapsed(deps.db, node.deck.id, !node.deck.collapsed).then(changed)}
            onMenu={(anchor) => actions.openMenu(node.deck, anchor)}
            nameSlot={renaming === node.deck.id ? (
              <div className={styles.rename} onClick={(e) => e.stopPropagation()}>
                <Input
                  label="Deck name"
                  hideLabel
                  autoFocus
                  value={name}
                  error={error}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void saveRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setRenaming(null);
                      ref.current?.focus();
                    }
                  }}
                />
              </div>
            ) : undefined}
          />
        ))}
      </div>
      {actions.ui}
    </>
  );
}
