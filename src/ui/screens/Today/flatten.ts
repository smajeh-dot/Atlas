import type { DeckTreeWithCounts } from '../../../services/deckService';

export interface VisibleRow {
  node: DeckTreeWithCounts;
  depth: number;
  parentId: number | null;
}

/** Rows currently on screen: children of collapsed decks are skipped. */
export function visibleRows(tree: DeckTreeWithCounts[]): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (nodes: DeckTreeWithCounts[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth, parentId: node.deck.parentId });
      if (!node.deck.collapsed) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
