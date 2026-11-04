import { useState } from 'react';
import { MOCK_CARDS, type MockCard } from '../../placeholderCards';
import { useAtlas } from '../../app/AtlasContext';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { TextArea } from '../../components/Input';
import { useHotkeys } from '../../keys';
import styles from './Session.module.css';

/** `next` is a made-up "next review" time, shown on each grade card. Real values will come from the scheduler. */
const GRADES = [
  { word: 'Again', cls: 'again', next: '10m' },
  { word: 'Hard', cls: 'hard', next: '1d' },
  { word: 'Good', cls: 'good', next: '3d' },
  { word: 'Easy', cls: 'easy', next: '7d' },
];

type Step = { kind: 'grade'; pos: number; which: number } | { kind: 'bury'; pos: number; card: number };

/**
 * The study session screen, running on made-up cards so the design can be tried out. Opened from a sub-deck
 * row or Study All on Today. Nothing is saved or scheduled yet.
 *
 * Layout: a strip of session controls (back, undo, cards left) above the progress bar; the card with its
 * own actions (edit, flag, bury) in its top-right corner; and the four grade cards underneath.
 */
export function Session({ target }: { target?: string }) {
  const { navigate } = useAtlas();
  const [cards, setCards] = useState<MockCard[]>(MOCK_CARDS);
  const [queue, setQueue] = useState<number[]>(() => MOCK_CARDS.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // How many cards have been marked Again, Hard, Good and Easy so far.
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [history, setHistory] = useState<Step[]>([]);
  const [flagged, setFlagged] = useState<number[]>([]);
  const [overlay, setOverlay] = useState<'leave' | 'edit' | null>(null);

  const done = pos >= queue.length;
  const cardId = queue[pos];
  const card = cardId === undefined ? undefined : cards[cardId];
  const marked = counts.reduce((a, b) => a + b, 0);
  const isFlagged = cardId !== undefined && flagged.includes(cardId);

  const leave = () => navigate({ name: 'today' });
  // Nothing to lose before the first card is marked, so leave straight away; otherwise ask first.
  const askToLeave = () => (history.length === 0 ? leave() : setOverlay('leave'));

  const flip = (e?: KeyboardEvent) => {
    // On a focused button, Enter or Space belongs to the button.
    if (done || e?.target instanceof HTMLButtonElement) return false;
    setFlipped((f) => !f);
  };
  const grade = (which: number) => {
    if (done || !flipped) return false;
    setCounts((c) => c.map((n, i) => (i === which ? n + 1 : n)));
    setHistory((h) => [...h, { kind: 'grade', pos, which }]);
    setFlipped(false);
    setPos((p) => p + 1);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return false;
    setHistory((h) => h.slice(0, -1));
    setPos(last.pos);
    if (last.kind === 'grade') {
      setCounts((c) => c.map((n, i) => (i === last.which ? n - 1 : n)));
      setFlipped(true); // back on the same card with the answer showing, ready to be graded again
    } else {
      setQueue((q) => [...q.slice(0, last.pos), last.card, ...q.slice(last.pos)]);
      setFlipped(false);
    }
  };
  const bury = () => {
    if (done || cardId === undefined) return false;
    setHistory((h) => [...h, { kind: 'bury', pos, card: cardId }]);
    setQueue((q) => q.filter((_, i) => i !== pos));
    setFlipped(false);
  };
  const flag = () => {
    if (done || cardId === undefined) return false;
    setFlagged((f) => (f.includes(cardId) ? f.filter((x) => x !== cardId) : [...f, cardId]));
  };
  const edit = () => {
    if (done) return false;
    setOverlay('edit');
  };
  const restart = () => {
    setQueue(cards.map((_, i) => i));
    setPos(0);
    setFlipped(false);
    setCounts([0, 0, 0, 0]);
    setHistory([]);
  };

  useHotkeys({
    Esc: askToLeave,
    Space: flip,
    Enter: flip,
    '1': () => grade(0),
    '2': () => grade(1),
    '3': () => grade(2),
    '4': () => grade(3),
    Z: undo,
    'Ctrl+Z': undo,
    E: edit,
    F: flag,
    B: bury,
  });

  return (
    <div className={styles.page} data-testid="session-screen" data-target={target}>
      <div className={styles.stack}>
        <div className={styles.top}>
          <div className={styles.strip}>
            <div className={styles.stripGroup}>
              <IconButton icon="back" label="Leave session" shortcut="Esc" className={styles.stripButton} onClick={askToLeave} />
              <IconButton icon="undo" label="Undo" shortcut="Z" className={styles.stripButton} disabled={history.length === 0} onClick={undo} />
            </div>
            <div className={styles.stripGroup}>
              <span className={styles.stat} data-testid="session-left">
                {queue.length - pos} left
              </span>
            </div>
          </div>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Session progress"
            aria-valuemin={0}
            aria-valuemax={queue.length}
            aria-valuenow={marked}
            data-testid="session-progress"
          >
            {GRADES.map(({ word, cls }, i) => (
              <span key={word} className={`${styles.segment} ${styles[cls]}`} style={{ width: `${queue.length === 0 ? 0 : ((counts[i] ?? 0) / queue.length) * 100}%` }} />
            ))}
          </div>
        </div>
        <section className={styles.card} aria-label="Flashcard" data-testid="session-card" onClick={done ? undefined : () => setFlipped((f) => !f)}>
          {done ? (
            <div className={styles.face}>
              <p className={styles.text}>All done</p>
              <button type="button" className={styles.restart} onClick={restart}>
                Go again
              </button>
            </div>
          ) : (
            <>
              <div className={`${styles.actions}`} onClick={(e) => e.stopPropagation()}>
                <IconButton icon="edit" label="Edit card" shortcut="E" className={styles.actionButton} onClick={edit} />
                <IconButton
                  icon="flag"
                  label={isFlagged ? 'Remove flag' : 'Flag card'}
                  shortcut="F"
                  className={`${styles.actionButton} ${isFlagged ? styles.flagOn : ''}`}
                  aria-pressed={isFlagged}
                  onClick={flag}
                />
                <IconButton icon="bury" label="Bury until tomorrow" shortcut="B" className={styles.actionButton} onClick={bury} />
              </div>
              <div className={styles.face}>
                <p className={flipped ? styles.textSmall : styles.text}>{card?.front}</p>
                {flipped && (
                  <>
                    <hr className={styles.rule} />
                    <p className={styles.text}>{card?.back}</p>
                  </>
                )}
              </div>
            </>
          )}
        </section>
        <div className={styles.row}>
          {GRADES.map(({ word, cls, next }, i) => (
            <button key={word} type="button" className={`${styles.smallCard} ${styles[cls]}`} data-testid="session-small-card" onClick={() => grade(i)}>
              <span className={styles.key} aria-hidden="true">{i + 1}</span>
              <span className={styles.label}>{word}</span>
              <span className={styles.next}>{next}</span>
            </button>
          ))}
        </div>
      </div>
      {overlay === 'leave' && (
        <Dialog title="Leave this session?" confirmLabel="Leave" cancelLabel="Keep going" onCancel={() => setOverlay(null)} onConfirm={leave}>
          <p className={styles.plain}>You have marked {marked} {marked === 1 ? 'card' : 'cards'} so far. Progress is not saved yet.</p>
        </Dialog>
      )}
      {overlay === 'edit' && cardId !== undefined && card && (
        <EditDialog
          card={card}
          onCancel={() => setOverlay(null)}
          onSave={(next) => {
            setCards((all) => all.map((c, i) => (i === cardId ? next : c)));
            setOverlay(null);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({ card, onSave, onCancel }: { card: MockCard; onSave(next: MockCard): void; onCancel(): void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  return (
    <Dialog title="Edit card" confirmLabel="Save" confirmDisabled={front.trim() === ''} onCancel={onCancel} onConfirm={() => onSave({ front: front.trim(), back: back.trim() })}>
      <TextArea label="Front" rows={3} value={front} onChange={(e) => setFront(e.target.value)} />
      <TextArea label="Back" rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
    </Dialog>
  );
}
