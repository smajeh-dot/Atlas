import { forwardRef, type ReactNode } from 'react';
import styles from './Shell.module.css';

/** Workbench: two floating panels. Tangerine: edge to edge, joined by a 2px border. Study hides the sidebar. */
export const Shell = forwardRef<HTMLElement, { sidebar: ReactNode | null; children: ReactNode }>(function Shell({ sidebar, children }, mainRef) {
  return (
    <div className={styles.shell}>
      {sidebar && <aside className={styles.side}>{sidebar}</aside>}
      <main ref={mainRef} tabIndex={-1} className={styles.main}>{children}</main>
    </div>
  );
});
