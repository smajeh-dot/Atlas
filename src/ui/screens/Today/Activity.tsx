import { studyDay, studyDayDate } from '../../../core/studyDay';
import { useAtlas } from '../../app/AtlasContext';
import { Heatmap, HeatLegend } from '../../components/Heatmap';
import { mockHeatmap } from '../../mockHeatmap';
import styles from './Activity.module.css';

/** Heatmap of the last year of studying, with month names and the current year bottom left. The numbers are made up for now. */
export function Activity() {
  const { deps, settings } = useAtlas();
  const today = studyDay(deps.clock.now(), settings.dayStartHour);
  const grid = mockHeatmap(today);
  return (
    <section className={styles.root} aria-label="Activity" data-testid="today-activity">
      <Heatmap grid={grid} months label="Reviews per day over the last year" />
      <div className={styles.foot}>
        <span className={styles.year}>{studyDayDate(today).getUTCFullYear()}</span>
        <HeatLegend />
      </div>
    </section>
  );
}
