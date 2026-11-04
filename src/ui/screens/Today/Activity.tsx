import { studyDay } from '../../../core/studyDay';
import { useAtlas } from '../../app/AtlasContext';
import { Heatmap, HeatLegend } from '../../components/Heatmap';
import { mockHeatmap } from '../../mockHeatmap';
import styles from './Activity.module.css';

/** Heatmap of the last year of studying, with month names. The numbers are made up for now. */
export function Activity() {
  const { deps, settings } = useAtlas();
  const grid = mockHeatmap(studyDay(deps.clock.now(), settings.dayStartHour));
  return (
    <section className={styles.root} aria-label="Activity" data-testid="today-activity">
      <div className={styles.head}>
        <span className={styles.title}>Activity</span>
        <span className={styles.sub}>Last year</span>
      </div>
      <Heatmap grid={grid} months label="Reviews per day over the last year" />
      <div className={styles.foot}>
        <HeatLegend />
      </div>
    </section>
  );
}
