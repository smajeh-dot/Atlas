import { formatInterval } from '../../../core/format';
import { getCardInfo } from '../../../services/cardInfo';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Dialog } from '../../components/Dialog';
import styles from './Study.module.css';

const DAY = 86_400_000;
const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const when = (t: number | null) => (t === null ? 'Not yet' : date.format(t));

/** The key numbers for the card on screen. The full review history comes with Browse. */
export function CardInfoDialog({ cardId, unknownFilters, onClose }: { cardId: number; unknownFilters: string[]; onClose(): void }) {
  const { deps } = useAtlas();
  const { data: info } = useData(() => getCardInfo(deps.db, cardId), [cardId]);
  const rows: [string, string][] = info ? [
    ['Added', when(info.added)],
    ['First review', when(info.firstReview)],
    ['Latest review', when(info.latestReview)],
    ['Due', info.due === null ? 'New card' : when(info.due)],
    ['Interval', info.reviews ? formatInterval(info.intervalDays * DAY) : 'None yet'],
    ['Stability', info.reviews ? formatInterval(info.stability * DAY) : 'None yet'],
    ['Difficulty', info.reviews ? `${Math.round(info.difficulty * 10)}%` : 'None yet'],
    ['Reviews', String(info.reviews)],
    ['Lapses', String(info.lapses)],
    ['Average time', info.averageMs === null ? 'None yet' : `${Math.round(info.averageMs / 1000)} seconds`],
    ['Deck', info.deckName],
    ['Note type', info.noteTypeName],
    ['Card', info.cardName],
  ] : [];
  return (
    <Dialog title="Card info" confirmLabel="Close" hideCancel onConfirm={onClose} onCancel={onClose}>
      <dl className={styles.info}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.infoRow}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {unknownFilters.length > 0 && (
        <p className={styles.infoNote}>This card's template uses filters Atlas doesn't know: {unknownFilters.join(', ')}. They show the raw field.</p>
      )}
    </Dialog>
  );
}
