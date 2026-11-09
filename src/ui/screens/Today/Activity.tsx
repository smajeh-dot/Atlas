import { studyDay, studyDayDate } from '../../../core/studyDay';
import { buildHeatmap, getHeatmap, HEATMAP_WEEKS } from '../../../services/todayService';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Heatmap, HeatLegend } from '../../components/Heatmap';
import styles from './Activity.module.css';

/**
 * Heatmap of the last year of studying, with month names and the current year bottom left. It shows your real answers (counted per study day),
 * and refreshes when you finish studying. Until they load it shows an empty grid of the same size.
 */
export function Activity() {
  const { deps, settings } = useAtlas();
  const { data } = useData(() => getHeatmap(deps.db, deps.clock.now()), []);
  const today = studyDay(deps.clock.now(), settings.dayStartHour);
  const grid = data ?? buildHeatmap(new Map(), today, settings.dayStartHour, HEATMAP_WEEKS);
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
