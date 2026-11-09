import { useEffect, useRef, useState } from 'react';
import { revealTypeIn } from '../../../core/typein';
import { CramSession } from '../../../services/cramSession';
import { useAtlas } from '../../app/AtlasContext';
import { answerView, questionView } from '../../card/display';
import { Button } from '../../components/Button';
import { CardView } from '../../components/CardView';
import { IconButton } from '../../components/IconButton';
import { useToast } from '../../components/Toast';
import { useHotkeys } from '../../keys';
import styles from './Cram.module.css';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Cram mode: a Right/Wrong round over a deck. Nothing here touches the schedule; the session keeps the round.
 * Layout follows the study session: a strip of controls, the progress bar, the card, then the two answers.
 */
export function Cram({ deckId }: { deckId: number }) {
  const { deps, navigate } = useAtlas();
  const toast = useToast();
  const [session, setSession] = useState<CramSession | null>(null);
  const [flipped, setFlipped] = useState(false);
  // The session is a plain object, so this makes the screen read it again after it changes.
  const [, refresh] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    CramSession.open(deps, deckId).then(
      (s) => alive && setSession(s),
      (e: unknown) => alive && toast.show({ message: `Atlas couldn't start cramming: ${message(e)}` }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const leave = () => navigate({ name: 'today' });

  /** Runs one change to the session, one at a time, then shows the card it leaves on screen. */
  const run = async (work: (s: CramSession) => Promise<unknown>, showAnswer = false) => {
    if (busy.current || !session) return;
    busy.current = true;
    try {
      await work(session);
      setFlipped(showAnswer);
      refresh((n) => n + 1);
    } catch (e) {
      toast.show({ message: `Atlas couldn't update this round: ${message(e)}` });
    } finally {
      busy.current = false;
    }
  };

  const current = session?.current() ?? null;
  const complete = !!session && session.isComplete();

  const answer = (right: boolean) => {
    if (!current || !flipped) return false;
    void run((s) => s.answer(right, current.card.id));
  };
  const flip = (e?: KeyboardEvent) => {
    // On a focused button, Enter or Space belongs to the button.
    if (!current || e?.target instanceof HTMLButtonElement) return false;
    setFlipped((f) => !f);
  };
  // Back on the same card with the answer showing, ready to be answered again.
  const undo = () => {
    if (!session?.canUndo()) return false;
    void run((s) => s.undo(), true);
  };

  useHotkeys({
    Esc: leave,
    Space: flip,
    ArrowLeft: () => answer(false),
    ArrowRight: () => answer(true),
    'Ctrl+Z': undo,
  });

  if (!session || session.isEmpty()) return <div className={styles.page} />;

  const { pool, queue, right, wrong } = session.state();
  const finished = pool.length - queue.length;

  return (
    <div className={styles.page} data-testid="cram-screen">
      <div className={styles.stack}>
        <div className={styles.top}>
          <div className={styles.strip}>
            <div className={styles.stripGroup}>
              <IconButton icon="back" label="Leave cram" shortcut="Esc" className={styles.stripButton} onClick={leave} />
              <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" className={styles.stripButton} disabled={!session.canUndo()} onClick={undo} />
              <IconButton icon="reset" label="Restart" className={styles.stripButton} onClick={() => {}} />
            </div>
            <span className={styles.stat} data-testid="cram-left">
              {queue.length} left
            </span>
          </div>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Cram progress"
            aria-valuemin={0}
            aria-valuemax={pool.length}
            aria-valuenow={finished}
          >
            <span className={styles.segment} style={{ width: `${(finished / pool.length) * 100}%` }} />
          </div>
        </div>
        <section
          className={styles.card}
          aria-label="Flashcard"
          data-testid="cram-card"
          onClick={(e) => {
            // Clicking a link or a hint is not a flip, and neither is finishing a text selection.
            const onControl = e.nativeEvent.composedPath().some((el) => el instanceof HTMLElement && el.matches('button, a, summary'));
            if (!onControl && window.getSelection()?.isCollapsed !== false) flip();
          }}
        >
          {complete ? (
            <div className={styles.face}>
              <h2 className={styles.text}>Round complete</h2>
              <p className={styles.result} data-testid="cram-result">
                {right} right · {wrong} wrong
              </p>
              <Button variant="primary" onClick={() => void run((s) => s.goAgain())}>
                Go again
              </Button>
            </div>
          ) : (
            current && <CramFace card={current} flipped={flipped} mediaUrl={deps.media.url} />
          )}
        </section>
        {!complete && (
          <div className={styles.row}>
            <button type="button" className={`${styles.answer} ${styles.wrong}`} aria-keyshortcuts="ArrowLeft" disabled={!flipped} onClick={() => answer(false)}>
              <span className={styles.key} aria-hidden="true">←</span>
              <span className={styles.label}>Wrong</span>
            </button>
            <button type="button" className={`${styles.answer} ${styles.right}`} aria-keyshortcuts="ArrowRight" disabled={!flipped} onClick={() => answer(true)}>
              <span className={styles.key} aria-hidden="true">→</span>
              <span className={styles.label}>Right</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The card as Study shows it, but with no type-in box: a type-in card is just a flip card here. */
function CramFace({ card, flipped, mediaUrl }: { card: NonNullable<ReturnType<CramSession['current']>>; flipped: boolean; mediaUrl(n: string): string }) {
  const q = questionView(card.question);
  const fields: Record<string, string> = {};
  card.noteType.fields.forEach((f, i) => (fields[f.name] = card.note.fields[i] ?? ''));
  // With no box to type in, a type-in card's back just shows the expected answer.
  const a = flipped ? answerView(revealTypeIn(card.answer, fields)) : null;
  return (
    <div key={card.card.id} className={styles.face}>
      {!a ? (
        <CardView html={q.html} size={q.size} css={card.noteType.css} mediaUrl={mediaUrl} />
      ) : a.front === null ? (
        <CardView html={a.answer} size={a.size} css={card.noteType.css} mediaUrl={mediaUrl} />
      ) : (
        <CardView html={questionView(a.front).html} size={q.size} answer={a.answer} answerSize={a.size} css={card.noteType.css} mediaUrl={mediaUrl} />
      )}
    </div>
  );
}
