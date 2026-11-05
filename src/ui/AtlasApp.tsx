import { useEffect, useMemo, useRef } from 'react';
import type { Settings as SettingsModel } from '../core/model';
import { getDeckTreeWithCounts } from '../services/deckService';
import { undoLast } from '../services/undo';
import { AtlasProvider, useAtlas, useData, type AppDeps, type Route } from './app/AtlasContext';
import { anyOverlayOpen } from './components/overlayStack';
import { ToastProvider, useToast } from './components/Toast';
import { useHotkeys } from './keys';
import { Decks } from './screens/Decks/Decks';
import { ImportScreen } from './screens/Import/ImportScreen';
import { Session } from './screens/Session/Session';
import { Settings } from './screens/Settings/Settings';
import { Study } from './screens/Study/Study';
import { Today } from './screens/Today/Today';
import { Welcome } from './screens/Welcome/Welcome';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { applyTheme, ThemeProvider } from './theme/ThemeProvider';

export function AtlasApp({ deps, initialSettings, initialRoute, notice }: {
  deps: AppDeps;
  initialSettings: SettingsModel;
  initialRoute?: Route;
  /** Shown once as a toast after start-up, e.g. that an interrupted import was undone. */
  notice?: string;
}) {
  return (
    <AtlasProvider deps={deps} initialSettings={initialSettings} initialRoute={initialRoute}>
      <ToastProvider>
        <Themed notice={notice} />
      </ToastProvider>
    </AtlasProvider>
  );
}

function Themed({ notice }: { notice?: string }) {
  const { settings, saveSettings } = useAtlas();
  useEffect(() => applyTheme(settings.theme), []);
  return (
    <ThemeProvider theme={settings.theme} onSave={saveSettings}>
      <Frame notice={notice} />
    </ThemeProvider>
  );
}

function Frame({ notice }: { notice?: string }) {
  const { deps, route, navigate, changed } = useAtlas();
  const toast = useToast();
  useEffect(() => {
    if (notice) toast.show({ message: notice });
  }, []);
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, deps.clock.now()), []);
  const hasDecks = (tree?.length ?? 0) > 0;
  // The import screen locks the rest of Atlas: no sidebar, no shortcuts, while it's open.
  const studying = route.name === 'study' || route.name === 'session' || route.name === 'import';
  const main = useRef<HTMLElement>(null);

  // After moving to another screen, keys go to that screen (Space on Today, for example), not to the
  // sidebar button that was clicked. A field the new screen focused itself keeps its focus.
  // An overlay that opened with the new screen (Add card) keeps the focus it took.
  useEffect(() => {
    const el = main.current;
    if (anyOverlayOpen()) return;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [route]);

  useHotkeys({
    A: () => navigate({ name: 'add' }),
    'Ctrl+,': () => navigate({ name: 'settings' }),
    'Ctrl+Z': async () => {
      try {
        const label = await undoLast(deps.db, deps.undo);
        toast.show({ message: label ? `Undid: ${label}` : 'Nothing to undo' });
      } catch (e) {
        toast.show({ message: `Atlas couldn't undo that: ${e instanceof Error ? e.message : String(e)}` });
      }
      changed();
    },
  }, { enabled: !studying, allowInInputs: ['Ctrl+,'] });

  if (!tree) return <Shell ref={main} sidebar={null}>{null}</Shell>;
  const showWelcome = !hasDecks && route.name !== 'settings' && route.name !== 'import';
  return (
    <Shell ref={main} sidebar={studying ? null : <Sidebar decks={tree} />}>
      {showWelcome ? <Welcome /> : <Screen route={route} />}
    </Shell>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'welcome':
      return <Welcome />;
    case 'today':
      return <Today />;
    case 'add':
      // Same element as 'today', so Home stays put (no reload) while the Add card overlay opens over it.
      return <Today addCard={{ deckId: route.deckId }} />;
    case 'decks':
      return <Decks deckId={route.deckId} />;
    case 'study':
      return <Study key={String(route.deckId)} deckId={route.deckId} />;
    case 'session':
      return <Session target={route.target} />;
    case 'settings':
      return <Settings section={route.section} />;
    case 'import':
      return <Import />;
  }
}

function Import() {
  const { deps, navigate, changed } = useAtlas();
  const flowDeps = useMemo(
    () => (deps.importer ? { ...deps.importer, db: deps.db, clock: deps.clock } : null),
    [deps],
  );
  if (!flowDeps) return null;
  return (
    <ImportScreen
      deps={flowDeps}
      onClose={() => {
        changed();
        navigate({ name: 'decks' });
      }}
    />
  );
}
