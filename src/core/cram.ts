import { shuffle } from './random';

export type Rng = () => number;

/** A missed card comes back after at least MIN_GAP and at most MAX_GAP other cards. */
export const MIN_GAP = 3;
export const MAX_GAP = 9;

export interface CramState {
  round: number;
  pool: number[];
  queue: number[];
  right: number;
  wrong: number;
}

export function startRound(pool: readonly number[], round: number, rng: Rng): CramState {
  return { round, pool: [...pool], queue: shuffle([...pool], rng), right: 0, wrong: 0 };
}

export function answerCram(state: CramState, right: boolean, rng: Rng): CramState {
  const [front, ...rest] = state.queue;
  if (front === undefined) return state;
  if (right) return { ...state, queue: rest, right: state.right + 1 };
  const gap = MIN_GAP + Math.floor(rng() * (MAX_GAP - MIN_GAP + 1));
  rest.splice(Math.min(gap, rest.length), 0, front);
  return { ...state, queue: rest, wrong: state.wrong + 1 };
}

export function isComplete(state: CramState): boolean {
  return state.queue.length === 0;
}

export function pruneState(state: CramState, keep: ReadonlySet<number>): CramState {
  return {
    ...state,
    pool: state.pool.filter((id) => keep.has(id)),
    queue: state.queue.filter((id) => keep.has(id)),
  };
}
