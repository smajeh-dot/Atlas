import { useEffect, useState } from 'react';
import type { Settings } from './core/model';
import { migrate } from './data/migrations';
import { recoverInterruptedImports } from './import/commit';
import { getSettings } from './data/settings';
import { systemClock } from './platform/clock';
import { tauriMedia } from './platform/media';
import { openUrl } from './platform/opener';
import { chooseAnkiFile, finishImport, prepareFile, tauriImportPlatform, tauriStaging } from './platform/importBridge';
import { getAppInfo, tauriDb } from './platform/tauriDb';
import { UndoStack } from './services/undo';
import type { AppDeps } from './ui/app/AtlasContext';
import { AtlasApp } from './ui/AtlasApp';
import { loadFonts } from './ui/theme/fonts';
import { applyTheme } from './ui/theme/ThemeProvider';
import './App.css';

type Status =
  | { kind: 'starting' }
  | { kind: 'ready'; deps: AppDeps; settings: Settings; notice?: string }
  | { kind: 'error'; message: string };

// Started once per page load so a double-mounted effect never migrates twice at the same time.
let startup: Promise<{ deps: AppDeps; settings: Settings; notice?: string } | { error: string }> | null = null;

function start() {
  startup ??= (async () => {
    const appInfo = await getAppInfo();
    if (appInfo.startupError) return { error: appInfo.startupError };
    await migrate(tauriDb, systemClock.now());
    // An import cut off by a crash or power cut is undone before anything else reads the data.
    const recovered = await recoverInterruptedImports(tauriDb, tauriImportPlatform);
    const settings = await getSettings(tauriDb);
    applyTheme(settings.theme);
    // Nothing renders until the fonts are ready, so text never flashes in a fallback font.
    await loadFonts();
    const importer = { staging: tauriStaging, platform: tauriImportPlatform, chooseFile: chooseAnkiFile, prepare: prepareFile, finish: finishImport };
    const deps: AppDeps = { db: tauriDb, clock: systemClock, undo: new UndoStack(), media: tauriMedia, openUrl, appInfo, importer };
    const notice = recovered > 0
      ? "An import didn't finish last time Atlas was open, so Atlas undid it. Your cards are as they were before it."
      : undefined;
    return { deps, settings, notice };
  })();
  return startup;
}

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'starting' });

  useEffect(() => {
    start().then(
      (r) => setStatus('error' in r ? { kind: 'error', message: r.error } : { kind: 'ready', ...r }),
      (e: unknown) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, []);

  if (status.kind === 'starting') return null;
  if (status.kind === 'error') {
    return (
      <main className="startup-problem">
        <h1>Atlas couldn't open your data</h1>
        <p className="startup-message">{status.message}</p>
        <p>Check that you can open %APPDATA%\Atlas in File Explorer, then reopen Atlas.</p>
      </main>
    );
  }
  return <AtlasApp deps={status.deps} initialSettings={status.settings} notice={status.notice} />;
}
