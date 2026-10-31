import { useEffect, useRef, useState } from 'react';
import { setDeckCollapsed } from '../../../data/decks';
import { getDeckTreeWithCounts } from '../../../services/deckService';
import { getTodaySummary, type TodaySummary } from '../../../services/todayService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { BarChart } from '../../components/BarChart';
import { Button } from '../../components/Button';
import { DeckRow } from '../../components/DeckRow';
import { Heatmap } from '../../components/Heatmap';
import { useHotkeys } from '../../keys';
import { useDeckActions } from './DeckActions';
import { visibleRows } from './flatten';
import styles from './Today.module.css';

export function Today() {
  const { deps, navigate, changed } = useAtlas();
  const now = () => deps.clock.now();
  const { data: summary } = useData(() => getTodaySummary(deps.db, now()), []);
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, now()), []);
  const actions = useDeckActions();
  const [selected, setSelected] = useState<number | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const rows = tree ? visibleRows(tree) : [];
  const index = rows.findIndex((r) => r.node.deck.id === selected);

  useEffect(() => {
    treeRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const study = (deckId: number | null) => navigate({ name: 'study', deckId });
  const toggle = async (id: number, collapsed: boolean) => {
    await setDeckCollapsed(deps.db, id, collapsed);
    changed();
  };
  // Keys belong to the deck table unless focus is on some other control.
  const forTable = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !t || t === document.body || treeRef.current?.contains(t) === true;
  };

  useHotkeys({
    Space: (e) => forTable(e) && summary && !summary.allDone ? study(null) : false,
    Enter: (e) => (forTable(e) && selected !== null ? study(selected) : false),
    ArrowDown: (e) => forTable(e) && rows.length ? setSelected(rows[Math.min(rows.length - 1, index + 1)]!.node.deck.id) : false,
    ArrowUp: (e) => forTable(e) && rows.length ? setSelected(rows[Math.max(0, index - 1)]!.node.deck.id) : false,
    ArrowLeft: (e) => {
      const row = rows[index];
      if (!forTable(e) || !row) return false;
      if (row.node.children.length && !row.node.deck.collapsed) void toggle(row.node.deck.id, true);
      else if (row.parentId !== null) setSelected(row.parentId);
    },
    ArrowRight: (e) => {
      const row = rows[index];
      if (!forTable(e) || !row) return false;
      if (row.node.children.length && row.node.deck.collapsed) void toggle(row.node.deck.id, false);
    },
    ContextMenu: () => openSelectedMenu(),
    'Shift+F10': () => openSelectedMenu(),
  });

  function openSelectedMenu() {
    const row = rows[index];
    const el = row && document.getElementById(`deck-row-${row.node.deck.id}`);
    if (!row || !el) return false;
    actions.openMenu(row.node.deck, el);
  }

  return (
    <div className={styles.page}>
      {summary && <Banner summary={summary} onStudy={() => study(null)} />}
      <div className={styles.grid}>
        <section className={styles.tableBox}>
          <div className={styles.head} aria-hidden="true">
            <span>Deck</span>
            <span className={styles.num}>New</span>
            <span className={styles.num}>Learn</span>
            <span className={styles.num}>Due</span>
            <span />
          </div>
          <div
            ref={treeRef}
            role="tree"
            aria-label="Decks"
            tabIndex={0}
            aria-activedescendant={selected !== null ? `deck-row-${selected}` : undefined}
            className={styles.tree}
            onFocus={() => selected === null && rows[0] && setSelected(rows[0].node.deck.id)}
          >
            {rows.map(({ node, depth }) => (
              <DeckRow
                key={node.deck.id}
                id={`deck-row-${node.deck.id}`}
                node={node}
                depth={depth}
                selected={node.deck.id === selected}
                showStudy
                onSelect={() => setSelected(node.deck.id)}
                onStudy={() => study(node.deck.id)}
                onToggle={() => void toggle(node.deck.id, !node.deck.collapsed)}
                onMenu={(anchor) => actions.openMenu(node.deck, anchor)}
              />
            ))}
          </div>
        </section>
        <div className={styles.side}>
          {summary && <StreakBox summary={summary} />}
          {summary && (
            <section className={styles.box}>
              <h2 className={styles.label}>Due in the next 7 days</h2>
              <BarChart label="Due in the next 7 days" bars={summary.forecast.map((f) => ({ label: f.label, count: f.count, highlight: f.today }))} />
            </section>
          )}
        </div>
      </div>
      {actions.ui}
    </div>
  );
}

function Banner({ summary, onStudy }: { summary: TodaySummary; onStudy(): void }) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroText}>
        <div className={styles.eyebrow}>{summary.dateLabel}</div>
        <h1 className={styles.heroTitle}>{summary.title}</h1>
        <p className={styles.heroSub}>{summary.sub}</p>
      </div>
      {!summary.allDone && (
        <Button size="lg" className={styles.heroButton} kbd="Space" onClick={onStudy}>Start studying</Button>
      )}
    </section>
  );
}

function StreakBox({ summary }: { summary: TodaySummary }) {
  const retention = summary.retention30 === null ? 'no reviews yet' : `${Math.round(summary.retention30 * 100)}%`;
  return (
    <section className={styles.box}>
      <h2 className={styles.label}>Streak</h2>
      <div className={styles.big}>{summary.streak} {summary.streak === 1 ? 'day' : 'days'}</div>
      <Heatmap grid={summary.heatmap} />
      <p className={styles.small}>Retention, last 30 days · {retention}</p>
    </section>
  );
}
