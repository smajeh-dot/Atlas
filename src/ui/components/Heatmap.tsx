import type { HeatCell } from '../../services/todayService';
import styles from './Heatmap.module.css';
import { Tooltip } from './Tooltip';

/** 12 weeks (oldest left) × 7 days (Monday at the top), shaded by review count quartile. */
export function Heatmap({ grid }: { grid: HeatCell[][] }) {
  return (
    <div role="img" aria-label="Reviews per day over the last 12 weeks" className={styles.grid}>
      {grid.map((col, c) => (
        <div key={c} className={styles.col}>
          {col.map((cell, r) =>
            cell ? (
              <Tooltip key={r} text={cell.label}>
                <span className={styles.cell} data-level={cell.level} />
              </Tooltip>
            ) : (
              <span key={r} className={styles.empty} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
