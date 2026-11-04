import styles from './BarChart.module.css';

export function BarChart({ label, bars }: { label: string; bars: { label: string; count: number; highlight?: boolean }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <ul aria-label={label} className={styles.chart}>
      {bars.map((b, i) => (
        <li key={i} className={styles.bar} data-highlight={!!b.highlight}>
          <span className={styles.value}>{b.count}</span>
          <span className={styles.track}>
            <span className={styles.fill} style={{ height: `${Math.max(b.count ? 4 : 0, (b.count / max) * 100)}%` }} />
          </span>
          <span className={styles.label}>{b.label}</span>
        </li>
      ))}
    </ul>
  );
}
