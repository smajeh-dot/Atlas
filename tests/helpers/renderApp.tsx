import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Db } from '../../src/data/db';
import { getSettings } from '../../src/data/settings';
import type { MediaPort } from '../../src/services/mediaService';
import { UndoStack } from '../../src/services/undo';
import type { Route } from '../../src/ui/app/AtlasContext';
import { AtlasApp } from '../../src/ui/AtlasApp';
import { fixedClock, T0 } from './fixtures';
import { createMigratedDb } from './testDb';

export interface FakeMedia extends MediaPort {
  written: Map<string, Uint8Array>;
}

export function fakeMedia(): FakeMedia {
  const written = new Map<string, Uint8Array>();
  return { written, url: (n) => `media://${n}`, write: async (n, b) => void written.set(n, b) };
}

export async function renderApp(opts: { db?: Db; clock?: ReturnType<typeof fixedClock>; route?: Route; fakeTimers?: boolean } = {}) {
  const db = opts.db ?? (await createMigratedDb());
  const clock = opts.clock ?? fixedClock(T0);
  const media = fakeMedia();
  const opened: string[] = [];
  const deps = {
    db,
    clock,
    undo: new UndoStack(),
    media,
    openUrl: async (url: string) => void opened.push(url),
    appInfo: { dataDir: 'C:\\Users\\sam\\AppData\\Roaming\\Atlas', dbPath: 'C:\\Users\\sam\\AppData\\Roaming\\Atlas\\atlas.db', version: '0.2.0', startupError: null },
  };
  const user = userEvent.setup(opts.fakeTimers ? { advanceTimers: (ms) => vi.advanceTimersByTime(ms) } : {});
  const result = render(<AtlasApp deps={deps} initialSettings={await getSettings(db)} initialRoute={opts.route} />);
  return { ...result, user, db, clock, deps, media, opened };
}
