import { studyDayDate } from '../../core/studyDay';
import type { HeatCell } from '../../services/todayService';
import styles from './Heatmap.module.css';
import { Tooltip } from './Tooltip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Where each month name goes: over the first column whose Monday is in a new month. */
export function monthMarks(grid: HeatCell[][]): { col: number; name: string }[] {
  const marks: { col: number; name: string }[] = [];
  let prev = -1;
  grid.forEach((col, c) => {
    const monday = col[0];
    if (!monday) return;
    const month = studyDayDate(monday.day).getUTCMonth();
    if (month !== prev) marks.push({ col: c, name: MONTHS[month]! });
    prev = month;
  });
  // A name for a month that only just started at the left edge would run into the next one, so drop it.
  if (marks.length > 1 && marks[1]!.col - marks[0]!.col < 3) marks.shift();
  return marks;
}

/** Weeks (oldest left) × 7 days (Monday at the top), shaded by review count quartile. `months` adds month names above the columns. */
export function Heatmap({ grid, label = 'Reviews per day over the last 12 weeks', months = false }: { grid: HeatCell[][]; label?: string; months?: boolean }) {
  const columns = { gridTemplateColumns: `repeat(${grid.length}, 1fr)` };
  return (
    <div>
      {months && (
        <div className={styles.months} style={columns} aria-hidden="true">
          {monthMarks(grid).map((m) => (
            <span key={m.col} style={{ gridColumn: m.col + 1 }}>{m.name}</span>
          ))}
        </div>
      )}
      <div role="img" aria-label={label} className={styles.grid} style={columns}>
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
    </div>
  );
}

/** "Less ▢▢▢▢▢ More" key for the shading. */
export function HeatLegend() {
  return (
    <div className={styles.legend} aria-hidden="true">
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <span key={level} className={styles.cell} data-level={level} />
      ))}
      <span>More</span>
    </div>
  );
}
