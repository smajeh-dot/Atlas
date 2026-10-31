import styles from './Count.module.css';

export function Count({ kind, value }: { kind: 'new' | 'learn' | 'due'; value: number }) {
  return (
    <span className={`${styles.count} ${styles[kind]}`} data-count={kind} data-zero={value === 0}>
      {value}
    </span>
  );
}
