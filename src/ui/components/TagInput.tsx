import { useId, useState } from 'react';
import { normaliseTags } from '../../services/noteService';
import { Chip } from './Chip';
import styles from './TagInput.module.css';

/** Chips plus a text box. Enter or Space commits; Backspace on an empty box removes the last tag. */
export function TagInput({ value, onChange, suggestions, label = 'Tags', inputRef }: {
  value: string[];
  onChange(tags: string[]): void;
  suggestions: string[];
  label?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();
  const have = new Set(value.map((t) => t.toLowerCase()));
  const q = text.trim().toLowerCase();
  const matches = q ? suggestions.filter((s) => s.toLowerCase().startsWith(q) && !have.has(s.toLowerCase())).slice(0, 8) : [];

  const commit = (raw: string) => {
    const next = normaliseTags([...value, raw]);
    if (next.length !== value.length) onChange(next);
    setText('');
    setActive(-1);
  };

  return (
    <div className={styles.box}>
      {value.map((t) => (
        <Chip key={t} onRemove={() => onChange(value.filter((x) => x !== t))}>{t}</Chip>
      ))}
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className={styles.input}
          placeholder={value.length ? '' : 'Add a tag'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
          }}
          onBlur={() => text.trim() && commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && matches.length) {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
            } else if (e.key === 'ArrowUp' && matches.length) {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Enter' || e.key === ' ') {
              const pick = active >= 0 ? matches[active] : text;
              if (pick?.trim()) {
                e.preventDefault();
                commit(pick);
              } else if (e.key === ' ') e.preventDefault();
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
        {matches.length > 0 && (
          <div role="listbox" id={listId} aria-label="Tag suggestions" className={styles.list}>
            {matches.map((m, i) => (
              <div
                key={m}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={styles.option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(m);
                }}
              >
                {m}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
