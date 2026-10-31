/** 31 Oct 2026 09:00 GMT (UK clocks went back on 25 Oct). */
export const T0 = Date.UTC(2026, 9, 31, 9);
export const MIN = 60_000;
export const DAY = 86_400_000;

export function fixedClock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}
