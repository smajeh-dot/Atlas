import type { Settings } from '../../../core/model';
import { Count } from '../../components/Count';
import styles from './ThemeCards.module.css';

type Theme = Settings['theme'];

const THEMES: { value: Theme; label: string }[] = [
  { value: 'workbench', label: 'Workbench' },
  { value: 'tangerine', label: 'Tangerine' },
];

/** A Today screen in miniature, drawn in the given theme regardless of the page's theme. */
function Miniature({ theme }: { theme: Theme }) {
  return (
    <div className={styles.viewport} aria-hidden="true">
      <div className={styles.page} data-theme={theme}>
        <div className={styles.side}>
          <div className={styles.mark}>A</div>
          <div className={styles.addLine} />
          <div className={styles.navLine} />
          <div className={styles.navLine} />
        </div>
        <div className={styles.main}>
          <div className={styles.hero}>
            <div>
              <div className={styles.eyebrow}>SATURDAY 31 OCTOBER</div>
              <div className={styles.heroTitle}>86 cards due today</div>
            </div>
            <span className={styles.heroButton}>Start studying</span>
          </div>
          <div className={styles.table}>
            {[['Biology', 12, 4, 31], ['Chemistry', 8, 0, 22], ['Physics', 0, 2, 17]].map(([name, n, l, d]) => (
              <div key={name} className={styles.row}>
                <span className={styles.rowName}>{name}</span>
                <Count kind="new" value={n as number} />
                <Count kind="learn" value={l as number} />
                <Count kind="due" value={d as number} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeCards({ value, onChange }: { value: Theme; onChange(t: Theme): void }) {
  return (
    <div role="radiogroup" aria-label="Look" className={styles.cards}>
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          aria-label={t.label}
          className={styles.card}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
              e.preventDefault();
              onChange(value === 'workbench' ? 'tangerine' : 'workbench');
            }
          }}
          tabIndex={value === t.value ? 0 : -1}
        >
          <Miniature theme={t.value} />
          <span className={styles.caption}>
            <span className={styles.radio} />
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}
