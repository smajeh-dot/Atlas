import { useEffect, useState } from 'react';
import { cardOrdsForNote } from '../../../core/cards';
import type { Note, NoteType } from '../../../core/model';
import { renderCard } from '../../../core/templates';
import { useAtlas } from '../../app/AtlasContext';
import { answerView, questionView } from '../../card/display';
import { CardView } from '../../components/CardView';
import { Segmented } from '../../components/Segmented';
import styles from './Editor.module.css';

/** Shows the card exactly as Study will, updating as you type (spec 10.5). */
export function Preview({ noteType, fields, tags, deckFullName }: { noteType: NoteType; fields: string[]; tags: string[]; deckFullName: string }) {
  const { deps } = useAtlas();
  const [side, setSide] = useState<'front' | 'back'>('front');
  const ords = cardOrdsForNote(noteType, fields);
  const [ord, setOrd] = useState(0);
  const shown = ords.includes(ord) ? ord : (ords[0] ?? 0);
  useEffect(() => setSide('front'), [noteType.id]);

  const note: Note = { id: 0, guid: '', noteTypeId: noteType.id, fields, sortField: '', tags, createdAt: 0, updatedAt: 0 };
  const isCloze = noteType.kind === 'cloze';
  const choices = isCloze
    ? ords.map((o) => ({ value: o, label: `c${o + 1}` }))
    : noteType.templates.length > 1 ? noteType.templates.map((t, i) => ({ value: i, label: t.name })) : [];

  let body;
  if (!ords.length) {
    body = <p className={styles.previewEmpty}>{isCloze ? 'Add a cloze to see a preview.' : 'Fill in the first field to see a preview.'}</p>;
  } else {
    const r = renderCard(noteType, note, shown, deckFullName);
    const q = questionView(r.question);
    if (side === 'front') {
      body = <CardView html={r.question} size={q.size} css={noteType.css} mediaUrl={deps.media.url} />;
    } else {
      const a = answerView(r.answer);
      body = a.front === null
        ? <CardView html={a.answer} size={a.size} css={noteType.css} mediaUrl={deps.media.url} />
        : <CardView html={questionView(a.front).html} size={q.size} answer={a.answer} answerSize={a.size} css={noteType.css} mediaUrl={deps.media.url} />;
    }
  }

  return (
    <section className={styles.preview} aria-label="Preview">
      <div className={styles.previewHead}>
        <span className={styles.label}>Preview</span>
        <div className={styles.previewControls}>
          {choices.length > 1 && <Segmented<number> label="Card" value={shown} options={choices} onChange={setOrd} />}
          <Segmented<'front' | 'back'> label="Side" value={side} onChange={setSide} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />
        </div>
      </div>
      <div className={styles.previewCard} data-testid="preview">{body}</div>
    </section>
  );
}
