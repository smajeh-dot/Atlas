import { useEffect } from 'react';
import type { Settings as SettingsModel } from '../core/model';
import { getDeckTreeWithCounts } from '../services/deckService';
import { undoLast } from '../services/undo';
import { AtlasProvider, useAtlas, useData, type AppDeps, type Route } from './app/AtlasContext';
import { ToastProvider, useToast } from './components/Toast';
import { useHotkeys } from './keys';
import { AddCard } from './screens/Editor/AddCard';
import { Decks } from './screens/Decks/Decks';
import { Settings } from './screens/Settings/Settings';
import { Study } from './screens/Study/Study';
import { Today } from './screens/Today/Today';
import { Welcome } from './screens/Welcome/Welcome';
import { Shell } from './shell/Shell';
import { Sidebar } from './shell/Sidebar';
import { applyTheme, ThemeProvider } from './theme/ThemeProvider';

export function AtlasApp({ deps, initialSettings, initialRoute }: { deps: AppDeps; initialSettings: SettingsModel; initialRoute?: Route }) {
  return (
    <AtlasProvider deps={deps} initialSettings={initialSettings} initialRoute={initialRoute}>
      <ToastProvider>
        <Themed />
      </ToastProvider>
    </AtlasProvider>
  );
}

function Themed() {
  const { settings, saveSettings } = useAtlas();
  useEffect(() => applyTheme(settings.theme), []);
  return (
    <ThemeProvider theme={settings.theme} onSave={saveSettings}>
      <Frame />
    </ThemeProvider>
  );
}

function Frame() {
  const { deps, route, navigate, changed } = useAtlas();
  const toast = useToast();
  const { data: tree } = useData(() => getDeckTreeWithCounts(deps.db, deps.clock.now()), []);
  const hasDecks = (tree?.length ?? 0) > 0;
  const studying = route.name === 'study';

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
  }, { enabled: !studying });

  if (!tree) return <Shell sidebar={null}>{null}</Shell>;
  const showWelcome = !hasDecks && route.name !== 'settings';
  return (
    <Shell sidebar={studying ? null : <Sidebar tree={tree} hasDecks={hasDecks} />}>
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
    case 'decks':
      return <Decks deckId={route.deckId} />;
    case 'study':
      return <Study key={String(route.deckId)} deckId={route.deckId} />;
    case 'add':
      return <AddCard deckId={route.deckId} />;
    case 'settings':
      return <Settings section={route.section} />;
  }
}
