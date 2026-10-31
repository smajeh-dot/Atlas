const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** Interval wording used on answer buttons and in tables (spec 8.10). */
export function formatInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} hr`;
  const days = Math.round(ms / DAY);
  if (days < 31) return days === 1 ? '1 day' : `${days} days`;
  if (days < 365) {
    const months = oneDecimal(days / 30);
    return months === '1' ? '1 month' : `${months} months`;
  }
  const years = oneDecimal(days / 365);
  return years === '1' ? '1 year' : `${years} years`;
}
