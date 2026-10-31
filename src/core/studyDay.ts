const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2000, 0, 1);

/**
 * Number of the study day containing `t`, counting from 1 January 2000.
 * Works on local calendar dates rather than subtracting hours from epoch ms,
 * so days stay contiguous across daylight-saving changes.
 */
export function studyDay(t: number, dayStartHour: number): number {
  const d = new Date(t);
  let y = d.getFullYear();
  let m = d.getMonth();
  let day = d.getDate();
  if (d.getHours() < dayStartHour) {
    const p = new Date(y, m, day - 1);
    y = p.getFullYear();
    m = p.getMonth();
    day = p.getDate();
  }
  return Math.round((Date.UTC(y, m, day) - EPOCH) / DAY_MS);
}

/** Epoch ms at which study day `day` begins, in local time. */
export function startOfStudyDay(day: number, dayStartHour: number): number {
  const c = new Date(EPOCH + day * DAY_MS);
  return new Date(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), dayStartHour).getTime();
}

export function nextRollover(t: number, dayStartHour: number): number {
  return startOfStudyDay(studyDay(t, dayStartHour) + 1, dayStartHour);
}
