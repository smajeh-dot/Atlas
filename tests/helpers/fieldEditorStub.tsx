import type { Editor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import type { FieldEditorProps } from '../../src/ui/editor/FieldEditor';

/**
 * Stands in for the TipTap field editor in screen tests: ProseMirror can't be typed into
 * reliably under jsdom. The real editor has its own tests in tests/ui/editor.
 */
export function FieldEditor({ label, value, onChange, editorRef, autoFocus }: FieldEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const fake = { commands: { focus: () => ref.current?.focus() }, chain: () => null, isActive: () => false, on() {}, off() {} } as unknown as Editor;
    editorRef?.(fake);
    return () => editorRef?.(null);
  }, []);
  return <textarea ref={ref} aria-label={label} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}
