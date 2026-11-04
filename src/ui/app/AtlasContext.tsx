import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Settings } from '../../core/model';
import { studyDay } from '../../core/studyDay';
import type { Db } from '../../data/db';
import { updateSettings } from '../../data/settings';
import type { ImportFlowDeps } from '../../services/importFlow';
import type { MediaPort } from '../../services/mediaService';
import type { UndoStack } from '../../services/undo';
import type { AppInfo } from '../../platform/tauriDb';

/** Everything the screens need from outside React. The app passes real adapters; tests pass fakes. */
export interface AppDeps {
  db: Db;
  clock: { now(): number };
  undo: UndoStack;
  media: MediaPort;
  openUrl(url: string): Promise<void>;
  appInfo: AppInfo;
  /** Anki import. Absent in tests and previews that don't exercise it. */
  importer?: Omit<ImportFlowDeps, 'db' | 'clock'>;
}

export type Route =
  | { name: 'welcome' }
  | { name: 'today' }
  | { name: 'decks'; deckId?: number }
  | { name: 'study'; deckId: number | null }
  /** The blank study session screen. `target` names what was opened (a sub-deck or a whole subject) until real decks exist. */
  | { name: 'session'; target?: string }
  | { name: 'add'; deckId?: number }
  | { name: 'settings'; section?: 'appearance' | 'study' | 'about' }
  | { name: 'import' };

interface AtlasValue {
  deps: AppDeps;
  route: Route;
  navigate(r: Route): void;
  settings: Settings;
  /** Validates and saves; throws SettingsError with a user-facing message. */
  saveSettings(patch: Partial<Settings>): Promise<void>;
  /** Bumped after every change so screens reload their data. */
  version: number;
  changed(): void;
}

const AtlasContext = createContext<AtlasValue | null>(null);

export function AtlasProvider({ deps, initialSettings, initialRoute, children }: {
  deps: AppDeps;
  initialSettings: Settings;
  initialRoute?: Route;
  children: ReactNode;
}) {
  const [route, setRoute] = useState<Route>(initialRoute ?? { name: 'today' });
  const [settings, setSettings] = useState(initialSettings);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await updateSettings(deps.db, patch));
  }, [deps.db]);
  const navigate = useCallback((r: Route) => setRoute(r), []);

  // A laptop that sleeps overnight may wake with Atlas in front and no focus event, so screens also
  // refresh when the window becomes visible and when the study day turns over.
  const day = useRef(studyDay(deps.clock.now(), settings.dayStartHour));
  useEffect(() => {
    const check = () => {
      const today = studyDay(deps.clock.now(), settings.dayStartHour);
      if (today !== day.current) {
        day.current = today;
        changed();
      }
    };
    const timer = setInterval(check, 60_000);
    const onVisible = () => document.visibilityState !== 'hidden' && changed();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deps.clock, settings.dayStartHour, changed]);
  const value = useMemo(
    () => ({ deps, route, navigate, settings, saveSettings, version, changed }),
    [deps, route, navigate, settings, saveSettings, version, changed],
  );
  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlas(): AtlasValue {
  const v = useContext(AtlasContext);
  if (!v) throw new Error('useAtlas must be used inside AtlasProvider');
  return v;
}

/**
 * Loads data for a screen and reloads it after any change, when `keys` change, and when the
 * window regains focus (so a screen left open overnight catches up with the new study day).
 * The previous data stays on screen while reloading, so nothing flickers.
 */
export function useData<T>(load: () => Promise<T>, keys: unknown[]): { data: T | undefined; error: Error | undefined; reload(): void } {
  const { version } = useAtlas();
  const [state, setState] = useState<{ data?: T; error?: Error }>({});
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let alive = true;
    loader.current().then(
      (data) => alive && setState({ data }),
      (e: unknown) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      alive = false;
    };
  }, [version, tick, ...keys]);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, reload };
}
