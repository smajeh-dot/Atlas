import { useState } from 'react';
import { getDeckSummary, getDeckTreeWithCounts } from '../../../services/deckService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { useDeckActions } from '../Today/DeckActions';
import { visibleRows } from '../Today/flatten';
import { DeckOptions } from './DeckOptions';
import { DeckTree } from './DeckTree';
import styles from './Decks.module.css';

const ROWS: [keyof Awaited<ReturnType<typeof getDeckSummary>>, string][] = [
  ['new', 'New'], ['learning', 'Learning'], ['young', 'Young'], ['mature', 'Mature'], ['suspended', 'Suspended'],
];

export function Decks({ deckId }: { deckId?: number }) {
  const { deps } = useAtlas();
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, deps.clock.now()), []);
  const [chosen, setChosen] = useState<number | null>(deckId ?? null);
  const actions = useDeckActions();
  const rows = tree ? visibleRows(tree) : [];
  const all = tree ? allIds(tree) : [];
  const selected = chosen !== null && all.includes(chosen) ? chosen : (rows[0]?.node.deck.id ?? null);
  const name = tree && selected !== null ? findName(tree, selected) : '';

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.head}>
          <h1 className={styles.title}>Decks</h1>
          <Button variant="secondary" icon="newDeck" onClick={() => actions.newDeck(null)}>New deck</Button>
        </div>
        <section className={styles.box}>
          {tree && <DeckTree tree={tree} selected={selected} onSelect={setChosen} />}
        </section>
      </div>
      <div className={styles.right}>
        {selected !== null && (
          <>
            <Summary deckId={selected} name={name} />
            <section className={styles.box}>
              <DeckOptions deckId={selected} />
            </section>
          </>
        )}
      </div>
      {actions.ui}
    </div>
  );
}

function Summary({ deckId, name }: { deckId: number; name: string }) {
  const { deps } = useAtlas();
  const { data } = useData(() => getDeckSummary(deps.db, deckId), [deckId]);
  return (
    <section aria-label={`Cards in ${name}`} className={styles.box}>
      <h2 className={styles.boxTitle}>{name}</h2>
      <dl className={styles.summary}>
        <div className={styles.total}>
          <dt>Total cards</dt>
          <dd>{data?.total ?? 0}</dd>
        </div>
        {ROWS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{data?.[key] ?? 0}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function allIds(tree: { deck: { id: number }; children: unknown[] }[]): number[] {
  return tree.flatMap((n) => [n.deck.id, ...allIds(n.children as typeof tree)]);
}

function findName(tree: { deck: { id: number; name: string }; children: unknown[] }[], id: number): string {
  for (const n of tree) {
    if (n.deck.id === id) return n.deck.name;
    const inner = findName(n.children as typeof tree, id);
    if (inner) return inner;
  }
  return '';
}
