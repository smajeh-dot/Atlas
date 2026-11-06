import { useCallback, useEffect, useRef, useState } from 'react';
import { formatInterval } from '../../../core/format';
import type { NoteType, Rating } from '../../../core/model';
import { cardsOfNote, getCard } from '../../../data/cards';
import { listDecks } from '../../../data/decks';
import { getNoteType } from '../../../data/noteTypes';
import { getNote } from '../../../data/notes';
import { StudySession, type SessionCard } from '../../../services/studySession';
import { useAtlas } from '../../app/AtlasContext';
import { answerView, questionView } from '../../card/display';
import { Button } from '../../components/Button';
import { CardView } from '../../components/CardView';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu, type MenuItem } from '../../components/Menu';
import { ProgressBar } from '../../components/ProgressBar';
import { useToast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { FLAG_NAMES, flagColour } from '../../deckColour';
import { SafetyBackupError } from '../../../services/backupService';
import { useHotkeys } from '../../keys';
import { AddCardOverlay } from '../Today/AddCardOverlay';
import { CardInfoDialog } from './CardInfoDialog';
import styles from './Study.module.css';

const MIN = 60_000;
const GRADES: { rating: Rating; word: string; cls: string }[] = [
  { rating: 1, word: 'Again', cls: 'again' },
  { rating: 2, word: 'Hard', cls: 'hard' },
  { rating: 3, word: 'Good', cls: 'good' },
  { rating: 4, word: 'Easy', cls: 'easy' },
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Editing = { noteType: NoteType; fields: string[]; deckId: number };

type Overlay =
  | { kind: 'flag' | 'more'; anchor: HTMLElement }
  | { kind: 'add'; editing: Editing }
  | { kind: 'info'; cardId: number; unknownFilters: string[] }
  | { kind: 'delete'; cards: number }
  | null;

export function Study({ deckId }: { deckId: number | null }) {
  const { deps, navigate, changed, settings } = useAtlas();
  const toast = useToast();
  const [session, setSession] = useState<StudySession | null>(null);
  const [deckName, setDeckName] = useState('');
  const [phase, setPhase] = useState<'question' | 'answer'>('question');
  const [typed, setTyped] = useState('');
  const [overlay, setOverlay] = useState<Overlay>(null);
  /**
   * The card on screen. It changes only when Atlas moves on (start, after an action, undo, edit,
   * or a learning card coming back), never just because time passed, so keys act on what is shown.
   */
  const [current, setCurrent] = useState<SessionCard | null>(null);
  const shownAt = useRef(deps.clock.now());
  const busy = useRef(false);
  const [startError, setStartError] = useState<string | null>(null);

  const show = useCallback((s: StudySession | null, keepPhase = false) => {
    setCurrent(s?.current() ?? null);
    if (!keepPhase) {
      setPhase('question');
      setTyped('');
      shownAt.current = deps.clock.now();
    }
  }, [deps.clock]);

  useEffect(() => {
    let alive = true;
    StudySession.start(deps, deckId).then((s) => {
      if (!alive) return;
      setSession(s);
      show(s);
    }, (e: unknown) => alive && setStartError(message(e)));
    if (deckId !== null) listDecks(deps.db).then((d) => alive && setDeckName(d.find((x) => x.id === deckId)?.name ?? ''), () => {});
    return () => {
      alive = false;
    };
  }, []);

  const leave = () => {
    changed();
    navigate({ name: 'today' });
  };

  const next = () => show(session);

  const run = async (work: () => Promise<void>, failure: string) => {
    if (busy.current || !session) return;
    busy.current = true;
    try {
      await work();
    } catch (e) {
      toast.show({ message: e instanceof SafetyBackupError ? e.message : `${failure}: ${message(e)}` });
    } finally {
      busy.current = false;
    }
  };

  const editingOf = (c: SessionCard): Editing => ({ noteType: c.noteType, fields: c.note.fields, deckId: c.card.deckId });
  // The leech toast outlives the card on screen, so this card is read back from the database.
  const editCardById = async (cardId: number) => {
    try {
      const card = await getCard(deps.db, cardId);
      const note = await getNote(deps.db, card.noteId);
      setOverlay({ kind: 'add', editing: { noteType: await getNoteType(deps.db, note.noteTypeId), fields: note.fields, deckId: card.deckId } });
    } catch (e) {
      toast.show({ message: `Atlas couldn't open that card: ${message(e)}` });
    }
  };

  const grade = (rating: Rating) => {
    if (phase !== 'answer' || !current) return;
    const id = current.card.id;
    const ms = deps.clock.now() - shownAt.current;
    void run(async () => {
      const r = await session!.answer(rating, ms, id);
      next();
      if (!r) return;
      if (r.leech) {
        const suspended = (await getCard(deps.db, id)).suspended;
        toast.show({
          message: suspended
            ? "This card keeps slipping, so it's been tagged as a leech and suspended."
            : "This card keeps slipping, so it's been tagged as a leech.",
          action: { label: 'Edit', onClick: () => void editCardById(id) },
        });
      }
    }, "Atlas couldn't save that answer");
  };

  const reveal = () => {
    if (phase === 'question' && current) setPhase('answer');
  };

  const change = (work: () => Promise<void>, done?: string) =>
    void run(async () => {
      await work();
      next();
      if (done) toast.show({ message: done });
    }, "Atlas couldn't change that card");

  const undo = () =>
    void run(async () => {
      const label = await session!.undo();
      next();
      toast.show({ message: label ? `Undid: ${label}` : 'Nothing to undo' });
    }, "Atlas couldn't undo that");

  const flag = (n: number) => current && change(() => session!.setFlag(n, current.card.id));
  const askDelete = async () => {
    if (!current) return;
    setOverlay({ kind: 'delete', cards: (await cardsOfNote(deps.db, current.note.id)).length });
  };

  const done = !!session && !current;
  const keys: Record<string, (e: KeyboardEvent) => unknown> = {
    Esc: leave,
    'Ctrl+Z': undo,
  };
  if (current) {
    Object.assign(keys, {
      Space: () => (phase === 'question' ? reveal() : grade(3)),
      Enter: () => (phase === 'question' ? reveal() : grade(3)),
      1: () => grade(1),
      2: () => grade(2),
      3: () => grade(3),
      4: () => grade(4),
      E: () => setOverlay({ kind: 'add', editing: editingOf(current) }),
      I: () => setOverlay({ kind: 'info', cardId: current.card.id, unknownFilters: current.unknownFilters }),
      '-': () => change(() => session!.buryCurrent(current.card.id), 'Card buried until tomorrow'),
      '@': () => change(() => session!.suspendCurrent(current.card.id), 'Card suspended'),
      'Ctrl+Delete': () => void askDelete(),
      'Ctrl+0': () => flag(0),
    });
    for (let n = 1; n <= 7; n++) keys[`Ctrl+${n}`] = () => flag(n);
  }
  // Esc leaves Study from anywhere (spec 11), including the type-in box.
  useHotkeys(keys, { allowInInputs: ['Esc'] });

  // Learning cards due soon bring the session back by themselves (spec 10.4).
  const learnAhead = settings.learnAheadMinutes * MIN;
  const nextDue = done ? session!.nextLearningDueAt() : null;
  useEffect(() => {
    if (nextDue === null) return;
    const t = setTimeout(() => show(session), Math.max(0, nextDue - learnAhead - deps.clock.now()));
    return () => clearTimeout(t);
  }, [nextDue, learnAhead, session]);

  if (startError) {
    return <div className={styles.page}><EmptyState title="Atlas couldn't start this session" text={startError} action={{ label: 'Back to Today', onClick: leave }} /></div>;
  }
  if (!session) return <div className={styles.page} />;

  const summary = session.summary();
  const left = session.remaining();
  const remaining = left.new + left.learn + left.review;
  const crumbs = (current?.deckName ?? deckName).split(' › ').filter(Boolean);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.left}>
          <IconButton icon="back" label="Leave study" shortcut="Esc" onClick={leave} />
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            {crumbs.map((c, i) => (
              <span key={i} className={i === crumbs.length - 1 ? styles.crumbLast : styles.crumb}>
                {i > 0 && <span className={styles.sep} aria-hidden="true">›</span>}
                {c}
              </span>
            ))}
          </nav>
        </div>
        <div className={styles.centre}>
          {settings.showRemainingCount && (current || summary.answers > 0) && (
            <Tooltip block text={`New ${left.new} · Learning ${left.learn} · Review ${left.review}`}>
              <div className={styles.progress} tabIndex={0}>
                <ProgressBar value={summary.answers / Math.max(1, summary.answers + remaining)} label="Progress" />
                <span className={styles.left_}>{remaining} left</span>
                {settings.showTimer && current && <Timer since={shownAt.current} clock={deps.clock} />}
              </div>
            </Tooltip>
          )}
        </div>
        <div className={styles.right}>
          {current && (
            <>
              <IconButton icon="edit" label="Edit card" shortcut="E" onClick={() => setOverlay({ kind: 'add', editing: editingOf(current) })} />
              <IconButton icon="flag" label="Flag" shortcut="Ctrl+1" onClick={(e) => setOverlay({ kind: 'flag', anchor: e.currentTarget })} />
              <IconButton icon="more" label="More" onClick={(e) => setOverlay({ kind: 'more', anchor: e.currentTarget })} />
            </>
          )}
        </div>
      </header>

      <div className={styles.stage}>
        {current ? (
          <StudyCard card={current} phase={phase} typed={typed} onTyped={setTyped} onReveal={reveal} mediaUrl={deps.media.url} />
        ) : summary.answers === 0 ? (
          <div className={styles.box}>
            <EmptyState
              title={deckName ? `Nothing to study in ${deckName} right now` : 'Nothing to study right now'}
              text="New cards you add will show up here."
              action={{ label: 'Add card', onClick: () => navigate({ name: 'add', deckId: deckId ?? undefined }) }}
            />
            {nextDue !== null && left.learn > 0 && (
              <p className={`${styles.plain} ${styles.returning}`}>{returnText(left.learn, nextDue, learnAhead, deps.clock.now())}</p>
            )}
          </div>
        ) : (
          <Complete summary={summary} learning={left.learn} nextDue={nextDue} learnAhead={learnAhead} now={deps.clock.now()} onBack={leave} />
        )}
      </div>

      {current && phase === 'answer' && (
        <div className={styles.actions}>
          <div className={styles.grades}>
            {GRADES.map((g) => (
              <button key={g.rating} type="button" className={`${styles.grade} ${styles[g.cls]}`} aria-keyshortcuts={String(g.rating)} onClick={() => grade(g.rating)}>
                <span className={styles.key} aria-hidden="true">{g.rating}</span>
                <span className={styles.word}>{g.word}</span>
                {settings.showIntervalsOnButtons && <span className={styles.interval}>{formatInterval(current.previews[g.rating])}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {overlay?.kind === 'flag' && (
        <Menu anchor={overlay.anchor} label="Flag" onClose={() => setOverlay(null)} items={[
          ...FLAG_NAMES.map((name, i): MenuItem => ({ label: name, swatch: flagColour(i + 1), shortcut: `Ctrl+${i + 1}`, onSelect: () => flag(i + 1) })),
          { label: 'Remove flag', shortcut: 'Ctrl+0', onSelect: () => flag(0) },
        ]} />
      )}
      {overlay?.kind === 'more' && current && (
        <Menu anchor={overlay.anchor} label="More" onClose={() => setOverlay(null)} items={[
          { label: 'Bury card', icon: 'bury', shortcut: '-', onSelect: () => change(() => session.buryCurrent(current.card.id), 'Card buried until tomorrow') },
          { label: 'Suspend card', icon: 'suspend', shortcut: '@', onSelect: () => change(() => session.suspendCurrent(current.card.id), 'Card suspended') },
          { label: 'Card info', icon: 'info', shortcut: 'I', onSelect: () => setOverlay({ kind: 'info', cardId: current.card.id, unknownFilters: current.unknownFilters }) },
          'divider',
          { label: 'Delete note', icon: 'trash', shortcut: 'Ctrl+Delete', danger: true, onSelect: () => void askDelete() },
        ]} />
      )}
      {overlay?.kind === 'add' && <AddCardOverlay editing={overlay.editing} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'info' && <CardInfoDialog cardId={overlay.cardId} unknownFilters={overlay.unknownFilters} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'delete' && (
        <Dialog title="Delete this note?" confirmLabel="Delete note" confirmVariant="danger" onCancel={() => setOverlay(null)}
          onConfirm={() => {
            setOverlay(null);
            const id = current?.card.id;
            change(() => session.deleteCurrentNote(id), 'Note deleted');
          }}>
          <p className={styles.plain}>This deletes its {plural(overlay.cards, 'card', 'cards')} and their review history. Ctrl+Z brings it back.</p>
        </Dialog>
      )}
    </div>
  );
}

function StudyCard({ card, phase, typed, onTyped, onReveal, mediaUrl }: {
  card: SessionCard;
  phase: 'question' | 'answer';
  typed: string;
  onTyped(v: string): void;
  onReveal(): void;
  mediaUrl(n: string): string;
}) {
  const q = questionView(card.question);
  const fields: Record<string, string> = {};
  card.noteType.fields.forEach((f, i) => (fields[f.name] = card.note.fields[i] ?? ''));
  const a = phase === 'answer' ? answerView(card.answer, q.typeIn ? { text: typed, fields } : undefined) : null;
  return (
    <div className={styles.card} data-testid="study-card">
      <div key={card.card.id} className={styles.cardBody}>
        {!a ? (
          <>
            <CardView html={q.html} size={q.size} css={card.noteType.css} mediaUrl={mediaUrl} />
            {q.typeIn && (
              <Input
                label="Your answer"
                hideLabel
                autoFocus
                placeholder="Type your answer, then press Enter"
                value={typed}
                onChange={(e) => onTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                    onReveal();
                  }
                }}
              />
            )}
          </>
        ) : a.front === null ? (
          <CardView html={a.answer} size={a.size} css={card.noteType.css} mediaUrl={mediaUrl} />
        ) : (
          <CardView html={questionView(a.front).html} size={q.size} answer={a.answer} answerSize={a.size} css={card.noteType.css} mediaUrl={mediaUrl} />
        )}
      </div>
    </div>
  );
}

function Complete({ summary, learning, nextDue, learnAhead, now, onBack }: {
  summary: { answers: number; durationMs: number; again: number };
  learning: number;
  nextDue: number | null;
  learnAhead: number;
  now: number;
  onBack(): void;
}) {
  const minutes = Math.max(1, Math.round(summary.durationMs / MIN));
  const pct = summary.answers ? Math.round(((summary.answers - summary.again) / summary.answers) * 100) : 0;

  return (
    <div className={`${styles.box} ${styles.complete}`}>
      <h2 className={styles.completeTitle}>Session complete</h2>
      <p className={styles.stats}>{plural(summary.answers, 'card', 'cards')} · {plural(minutes, 'minute', 'minutes')} · {pct}% remembered</p>
      {nextDue !== null && learning > 0 && <p className={styles.plain}>{returnText(learning, nextDue, learnAhead, now)}</p>}
      <Button variant="primary" kbd="Enter" autoFocus onClick={onBack}>Back to Today</Button>
    </div>
  );
}

function returnText(learning: number, nextDue: number, learnAhead: number, now: number): string {
  const back = Math.max(1, Math.ceil((nextDue - learnAhead - now) / MIN));
  return `${learning === 1 ? '1 card comes' : `${learning} cards come`} back in ${plural(back, 'minute', 'minutes')}. Atlas will bring them up if you stay here.`;
}

function Timer({ since, clock }: { since: number; clock: { now(): number } }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((clock.now() - since) / 1000));
  return <span className={styles.timer}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}
