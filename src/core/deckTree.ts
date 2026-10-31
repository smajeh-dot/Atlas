import type { Deck } from './model';

export interface DeckNode {
  deck: Deck;
  children: DeckNode[];
}

const byPosition = (a: Deck, b: Deck) => a.position - b.position || a.name.localeCompare(b.name);

export function buildDeckTree(decks: Deck[]): DeckNode[] {
  const make = (parentId: number | null): DeckNode[] =>
    decks
      .filter((d) => d.parentId === parentId)
      .sort(byPosition)
      .map((deck) => ({ deck, children: make(deck.id) }));
  return make(null);
}

export function treeOrder(decks: Deck[]): number[] {
  const out: number[] = [];
  const walk = (nodes: DeckNode[]) => nodes.forEach((n) => (out.push(n.deck.id), walk(n.children)));
  walk(buildDeckTree(decks));
  return out;
}

export function descendantIds(decks: Deck[], id: number): number[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const d of decks) if (d.parentId === out[i]) out.push(d.id);
  }
  return out;
}

export function ancestorIds(decks: Deck[], id: number): number[] {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const out: number[] = [];
  let p = byId.get(id)?.parentId ?? null;
  while (p !== null && !out.includes(p)) {
    out.push(p);
    p = byId.get(p)?.parentId ?? null;
  }
  return out;
}

export function fullName(decks: Deck[], id: number, sep = ' › '): string {
  const byId = new Map(decks.map((d) => [d.id, d]));
  return [...ancestorIds(decks, id).reverse(), id].map((x) => byId.get(x)?.name ?? '?').join(sep);
}
