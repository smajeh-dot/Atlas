import type { Editor } from '@tiptap/react';
import { useEffect, useReducer } from 'react';
import { nextClozeNumber } from '../../core/cloze';
import { ariaKeys } from '../components/Kbd';
import { Tooltip } from '../components/Tooltip';
import { Icon, type IconName } from '../icons/icons';
import styles from './Toolbar.module.css';

interface Tool {
  label: string;
  shortcut?: string;
  icon?: IconName;
  text?: string;
  active?: boolean;
  run(): void;
}

/** Formatting for whichever field has focus (spec 10.5). Buttons keep the focus in the field. */
export function Toolbar({ editor, isCloze, onPickImage, getAllText }: { editor: Editor | null; isCloze: boolean; onPickImage(): void; getAllText(): string }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on('selectionUpdate', rerender);
    editor.on('transaction', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('transaction', rerender);
    };
  }, [editor]);

  const chain = () => editor?.chain().focus();
  const groups: Tool[][] = [
    [
      { label: 'Bold', shortcut: 'Ctrl+B', icon: 'bold', active: editor?.isActive('bold'), run: () => chain()?.toggleBold().run() },
      { label: 'Italic', shortcut: 'Ctrl+I', icon: 'italic', active: editor?.isActive('italic'), run: () => chain()?.toggleItalic().run() },
      { label: 'Underline', shortcut: 'Ctrl+U', icon: 'underline', active: editor?.isActive('underline'), run: () => chain()?.toggleUnderline().run() },
    ],
    [
      { label: 'Superscript', shortcut: 'Ctrl+Shift+=', icon: 'superscript', active: editor?.isActive('superscript'), run: () => chain()?.toggleSuperscript().run() },
      { label: 'Subscript', shortcut: 'Ctrl+=', icon: 'subscript', active: editor?.isActive('subscript'), run: () => chain()?.toggleSubscript().run() },
    ],
    [
      { label: 'Equation', shortcut: 'Ctrl+M', icon: 'sigma', run: () => chain()?.insertMath().run() },
      { label: 'Image', icon: 'image', run: onPickImage },
    ],
    ...(isCloze
      ? [[{ label: 'Cloze', shortcut: 'Ctrl+Shift+C', text: '[…] Cloze', run: () => chain()?.wrapCloze(nextClozeNumber(getAllText(), false)).run() }]]
      : []),
  ];

  return (
    <div role="toolbar" aria-label="Formatting" className={styles.toolbar}>
      {groups.map((group, g) => (
        <div key={g} className={styles.group}>
          {group.map((t) => (
            <Tooltip key={t.label} text={t.label} shortcut={t.shortcut}>
              <button
                type="button"
                className={t.text && t.text.length > 2 ? `${styles.tool} ${styles.wide}` : styles.tool}
                aria-label={t.label}
                aria-pressed={t.active === undefined ? undefined : t.active}
                aria-keyshortcuts={t.shortcut ? ariaKeys(t.shortcut) : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={t.run}
              >
                {t.icon ? <Icon name={t.icon} /> : <span aria-hidden="true">{t.text}</span>}
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}
