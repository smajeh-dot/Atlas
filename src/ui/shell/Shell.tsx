import type { ReactNode } from 'react';
import styles from './Shell.module.css';

/** Workbench: two floating panels. Tangerine: edge to edge, joined by a 2px border. Study hides the sidebar. */
export function Shell({ sidebar, children }: { sidebar: ReactNode | null; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {sidebar && <aside className={styles.side}>{sidebar}</aside>}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
