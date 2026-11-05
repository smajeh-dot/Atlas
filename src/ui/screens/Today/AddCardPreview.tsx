import { cardOrdsForNote } from '../../../core/cards';
import type { Note, NoteType } from '../../../core/model';
import { renderCard } from '../../../core/templates';
import { useAtlas } from '../../app/AtlasContext';
import { answerView, questionView } from '../../card/display';
import { CardView } from '../../components/CardView';
import styles from './AddCardPreview.module.css';

/**
 * A card that shows what you're typing as Study will show it (fronts, then the answer under its divider, with equations drawn by KaTeX),
 * redrawn on every keystroke. It's blank until the card type would make a card from what's been typed. It shows the type's first card.
 */
export function AddCardPreview({ noteType, fields, deckFullName }: { noteType: NoteType; fields: string[]; deckFullName: string }) {
  const { deps } = useAtlas();
  const ords = cardOrdsForNote(noteType, fields);
  let body = null;
  if (ords.length) {
    const note: Note = { id: 0, guid: '', noteTypeId: noteType.id, fields, sortField: '', tags: [], createdAt: 0, updatedAt: 0 };
    const rendered = renderCard(noteType, note, ords[0]!, deckFullName);
    const question = questionView(rendered.question);
    const byName: Record<string, string> = {};
    noteType.fields.forEach((f, i) => (byName[f.name] = fields[i] ?? ''));
    // Nothing is being answered here, so a type-in card shows its correct answer under the divider, as Study does afterwards.
    const answer = answerView(rendered.answer, { text: '', fields: byName });
    body = answer.front === null
      ? <CardView html={answer.answer} size={answer.size} css={noteType.css} mediaUrl={deps.media.url} />
      : <CardView html={questionView(answer.front).html} size={question.size} answer={answer.answer} answerSize={answer.size} css={noteType.css} mediaUrl={deps.media.url} />;
  }
  return <section className={styles.card} aria-label="Live preview" data-testid="add-card-preview">{body}</section>;
}
