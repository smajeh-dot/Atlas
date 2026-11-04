import styles from './Slider.module.css';

export function Slider({ label, min, max, step, value, onChange, format }: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange(v: number): void;
  format(v: number): string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={styles.row}>
      <input
        type="range"
        aria-label={label}
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.value}>{format(value)}</span>
    </div>
  );
}
