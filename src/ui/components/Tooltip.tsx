import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Kbd } from './Kbd';
import styles from './Tooltip.module.css';

const DELAY_MS = 400;

/** Shows after 400 ms of hover, or straight away on keyboard focus (spec 9). */
export function Tooltip({ text, shortcut, children, block }: { text: string; shortcut?: string; children: ReactNode | ReactElement; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => () => clearTimeout(timer.current), []);
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span
      className={block ? `${styles.wrap} ${styles.block}` : styles.wrap}
      onMouseOver={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), DELAY_MS);
      }}
      onMouseLeave={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible') || e.target === document.activeElement) setOpen(true);
      }}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span role="tooltip" id={id} className={styles.tip}>
          {text}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </span>
      )}
    </span>
  );
}
