import { useAtlas } from '../../app/AtlasContext';
import { Heatmap, HeatLegend } from '../../components/Heatmap';
import { mockHeatmap } from '../../mockHeatmap';
import styles from './ActivityCard.module.css';

const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/** Heatmap of how much you've studied lately. The numbers are made up for now. */
export function ActivityCard() {
  const { deps } = useAtlas();
  const grid = mockHeatmap(deps.clock.now());
  return (
    <section className={styles.card} aria-label="Activity" data-testid="today-activity-card">
      <div className={styles.head}>
        <span className={styles.title}>Activity</span>
        <span className={styles.sub}>Last 12 weeks</span>
      </div>
      <div className={styles.body}>
        <div className={styles.weekdays} aria-hidden="true">
          {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className={styles.map}>
          <Heatmap grid={grid} />
        </div>
      </div>
      <div className={styles.foot}>
        <HeatLegend />
      </div>
    </section>
  );
}
