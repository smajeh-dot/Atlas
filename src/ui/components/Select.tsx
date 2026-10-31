import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/icons';
import styles from './Select.module.css';
import { useOverlayLayer } from './overlayStack';

export interface SelectOption<T> {
  value: T;
  label: string;
  depth?: number;
}

/** Looks like an input; opens a list below it instead of the native dropdown, with optional type-to-filter. */
export function Select<T extends string | number>({ label, value, options, onChange, filterable, hideLabel, disabled }: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange(v: T): void;
  filterable?: boolean;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className={styles.field}>
      <span id={labelId} className={hideLabel ? styles.hidden : styles.label}>{label}</span>
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${labelId}-value`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={`${labelId}-value`} className={styles.value}>{current?.label ?? ''}</span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <SelectList
          anchor={button.current!}
          label={label}
          options={options}
          value={value}
          filterable={!!filterable}
          onPick={(v) => {
            setOpen(false);
            button.current?.focus();
            if (v !== value) onChange(v);
          }}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function SelectList<T extends string | number>({ anchor, label, options, value, filterable, onPick, onClose }: {
  anchor: HTMLElement;
  label: string;
  options: SelectOption<T>[];
  value: T;
  filterable: boolean;
  onPick(v: T): void;
  onClose(): void;
}) {
  const isTop = useOverlayLayer();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const listId = useId();
  const r = anchor.getBoundingClientRect();

  useEffect(() => {
    (filterable ? input.current : ref.current)?.focus();
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  useEffect(() => {
    ref.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isTop()) return;
    if (e.key === 'ArrowDown') setActive((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') {
      const o = shown[active];
      if (o) onPick(o.value);
    } else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else if (!filterable && e.key.length === 1) {
      // Without a filter box, a letter jumps to the next option starting with it.
      const i = shown.findIndex((o, k) => k > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={{ top: r.bottom + 4, left: r.left, minWidth: Math.max(220, r.width) }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {filterable && (
        <input
          ref={input}
          className={styles.filter}
          aria-label={`Filter ${label.toLowerCase()}`}
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          placeholder="Type to filter"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
      )}
      <div role="listbox" id={listId} aria-label={label} className={styles.list}>
        {shown.map((o, i) => (
          <div
            key={String(o.value)}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={o.value === value}
            data-active={i === active}
            className={styles.option}
            style={{ paddingLeft: 10 + (query ? 0 : (o.depth ?? 0) * 14) }}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </div>
        ))}
        {!shown.length && <div className={styles.none}>No matches</div>}
      </div>
    </div>,
    document.body,
  );
}
