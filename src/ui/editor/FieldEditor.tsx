import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useEffect, useId, useRef } from 'react';
import { useToast } from '../components/Toast';
import { atlasExtensions } from './extensions';
import styles from './FieldEditor.module.css';
import { fromEditorHtml, toEditorHtml } from './fieldHtml';

export interface FieldEditorProps {
  label: string;
  value: string;
  onChange(html: string): void;
  mediaUrl(name: string): string;
  /** Saves a pasted, dropped or chosen image and returns its bare media name. */
  onImage(file: File): Promise<string>;
  /** Every field of the note, so new cloze numbers continue across fields. */
  getAllText(): string;
  /** Receives the editor once it exists (and null when it goes), for the toolbar and focus. */
  editorRef?: (e: Editor | null) => void;
  onFocusEditor?(e: Editor): void;
  /** Ctrl+Enter: add or save the note. */
  onSubmit?(): void;
  autoFocus?: boolean;
}

export function FieldEditor({ label, value, onChange, mediaUrl, onImage, getAllText, editorRef, onFocusEditor, onSubmit, autoFocus }: FieldEditorProps) {
  const labelId = useId();
  const toast = useToast();
  const lastEmitted = useRef(value);
  const props = useRef({ onChange, onImage, getAllText, onFocusEditor, editorRef, onSubmit });
  props.current = { onChange, onImage, getAllText, onFocusEditor, editorRef, onSubmit };
  const self = useRef<Editor | null>(null);

  const insertFiles = (files: FileList | File[] | undefined | null): boolean => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    for (const file of images) {
      props.current.onImage(file).then(
        (name) => self.current?.chain().focus().insertImage(name).run(),
        (e: unknown) => toast.show({ message: e instanceof Error ? e.message : String(e) }),
      );
    }
    return true;
  };

  const editor = useEditor({
    extensions: atlasExtensions({ mediaUrl, getAllText: () => props.current.getAllText(), onSubmit: () => props.current.onSubmit?.() }),
    content: toEditorHtml(value),
    immediatelyRender: true,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelId, class: styles.prose ?? '' },
      handlePaste: (_view, event) => {
        if (!insertFiles(event.clipboardData?.files)) return false;
        event.preventDefault();
        return true;
      },
      handleDrop: (_view, event) => {
        if (!insertFiles((event as DragEvent).dataTransfer?.files)) return false;
        event.preventDefault();
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = fromEditorHtml(e.getHTML());
      lastEmitted.current = html;
      props.current.onChange(html);
    },
    onFocus: ({ editor: e }) => props.current.onFocusEditor?.(e),
  });
  self.current = editor;

  // Outside changes (Clear, or fields emptied after adding) replace the content without echoing back.
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    props.current.editorRef?.(editor);
    return () => props.current.editorRef?.(null);
  }, [editor]);

  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>{label}</span>
      <EditorContent editor={editor} className={styles.box} />
    </div>
  );
}
