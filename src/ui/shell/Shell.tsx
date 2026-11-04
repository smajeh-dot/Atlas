import { forwardRef, type ReactNode } from 'react';
import styles from './Shell.module.css';

/** Light (internally 'workbench'): two floating panels. Study hides the sidebar. */
export const Shell = forwardRef<HTMLElement, { sidebar: ReactNode | null; children: ReactNode }>(function Shell({ sidebar, children }, mainRef) {
  return (
    <div className={styles.shell}>
      {sidebar && <aside className={styles.side}>{sidebar}</aside>}
      <main ref={mainRef} tabIndex={-1} className={styles.main}>{children}</main>
    </div>
  );
});
