import type { Editor } from '@tiptap/react';
import { useRef, useState } from 'react';
import type { NoteType } from '../../core/model';
import { saveImage } from '../../services/mediaService';
import { useAtlas } from '../app/AtlasContext';
import { TagInput } from '../components/TagInput';
import { useToast } from '../components/Toast';
import { matchKey } from '../keys';
import { Preview } from '../screens/Editor/Preview';
import styles from '../screens/Editor/Editor.module.css';
import { FieldEditor } from './FieldEditor';
import { Toolbar } from './Toolbar';

const CLOZE_HINT = 'Select text and press Ctrl+Shift+C to hide it. Ctrl+Alt+Shift+C hides it in the same card as the last one.';

/** Fields, toolbar, tags and live preview: the body of Add card and Edit card (spec 10.5). */
export function NoteEditor({ noteType, fields, onFields, tags, onTags, tagSuggestions, deckFullName, firstFieldRef, autoFocus }: {
  noteType: NoteType;
  fields: string[];
  onFields(f: string[]): void;
  tags: string[];
  onTags(t: string[]): void;
  tagSuggestions: string[];
  /** "::"-separated, as templates expect. */
  deckFullName: string;
  firstFieldRef?: React.MutableRefObject<Editor | null>;
  autoFocus?: boolean;
}) {
  const { deps } = useAtlas();
  const toast = useToast();
  const [focused, setFocused] = useState<Editor | null>(null);
  const editors = useRef<(Editor | null)[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const tagsInput = useRef<HTMLInputElement>(null);
  const latest = useRef(fields);
  latest.current = fields;
  const isCloze = noteType.kind === 'cloze';

  const onImage = async (file: File) => saveImage(deps.media, new Uint8Array(await file.arrayBuffer()), file.type);
  const allText = () => latest.current.join('\n');

  return (
    <div
      className={styles.columns}
      onKeyDown={(e) => {
        // Handled here rather than app-wide so it also works inside the Edit card sheet.
        if (matchKey(e.nativeEvent, 'Ctrl+Shift+T')) {
          e.preventDefault();
          tagsInput.current?.focus();
        }
      }}
    >
      <div className={styles.fieldsColumn}>
        <Toolbar editor={focused ?? editors.current[0] ?? null} isCloze={isCloze} onPickImage={() => fileInput.current?.click()} getAllText={allText} />
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          aria-label="Choose an image"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const name = await onImage(file);
              (focused ?? editors.current[0])?.chain().focus().insertImage(name).run();
            } catch (err) {
              toast.show({ message: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
        {noteType.fields.map((f, i) => (
          <div key={`${noteType.id}-${f.name}`} className={styles.fieldWrap}>
            <FieldEditor
              label={f.name}
              value={fields[i] ?? ''}
              autoFocus={autoFocus && i === 0}
              mediaUrl={deps.media.url}
              getAllText={allText}
              onImage={onImage}
              onFocusEditor={setFocused}
              editorRef={(e) => {
                editors.current[i] = e;
                if (i === 0 && firstFieldRef) firstFieldRef.current = e;
              }}
              onChange={(html) => {
                const next = [...latest.current];
                while (next.length < noteType.fields.length) next.push('');
                next[i] = html;
                latest.current = next;
                onFields(next);
              }}
            />
            {isCloze && i === 0 && <p className={styles.hint}>{CLOZE_HINT}</p>}
          </div>
        ))}
        <div className={styles.fieldWrap}>
          <span className={styles.label}>Tags</span>
          <TagInput value={tags} onChange={onTags} suggestions={tagSuggestions} inputRef={tagsInput} />
        </div>
      </div>
      <Preview noteType={noteType} fields={fields} tags={tags} deckFullName={deckFullName} />
    </div>
  );
}
