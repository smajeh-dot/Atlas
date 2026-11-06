import { forwardRef, type ReactNode } from 'react';
import styles from './Shell.module.css';

/** Light (internally 'workbench'): one main area, centred in the window. */
export const Shell = forwardRef<HTMLElement, { children: ReactNode }>(function Shell({ children }, mainRef) {
  return (
    <div className={styles.shell}>
      <main ref={mainRef} tabIndex={-1} className={styles.main}>{children}</main>
    </div>
  );
});
