import { useEffect, useState } from 'react';
import { migrate } from './data/migrations';
import { recoverInterruptedImports } from './import/commit';
import { chooseAnkiFile, finishImport, prepareFile, tauriImportPlatform, tauriStaging } from './platform/importBridge';
import { getAppInfo, tauriDb, type AppInfo } from './platform/tauriDb';
import { systemClock } from './platform/clock';
import type { ImportFlowDeps } from './services/importFlow';
import { runSelfCheck, type SelfCheckResult } from './services/selfCheck';
import { ImportScreen } from './ui/ImportScreen';
import './App.css';

const importDeps: ImportFlowDeps = {
  db: tauriDb,
  staging: tauriStaging,
  platform: tauriImportPlatform,
  clock: systemClock,
  chooseFile: chooseAnkiFile,
  prepare: prepareFile,
  finish: finishImport,
};

type Status =
  | { kind: 'checking' }
  | { kind: 'done'; info: AppInfo; check: SelfCheckResult; recovered: number }
  | { kind: 'error'; message: string };

// Started once per page load so a double-mounted effect never migrates twice at the same time.
let startup: Promise<{ info: AppInfo; check: SelfCheckResult; recovered: number }> | null = null;
function start() {
  startup ??= (async () => {
    const info = await getAppInfo();
    await migrate(tauriDb, systemClock.now());
    // An import cut off by a crash or power cut is undone before anything else reads the data.
    const recovered = await recoverInterruptedImports(tauriDb, tauriImportPlatform);
    return { info, check: await runSelfCheck(tauriDb, systemClock.now()), recovered };
  })();
  return startup;
}

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    start().then(
      (r) => setStatus({ kind: 'done', ...r }),
      (e: unknown) => setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, []);

  if (status.kind === 'checking') {
    return <main className="setup"><p>Checking your data…</p></main>;
  }
  if (status.kind === 'error') {
    return (
      <main className="setup">
        <h1>Atlas couldn't open your data</h1>
        <p className="problem">{status.message}</p>
      </main>
    );
  }
  if (importing) {
    return (
      <ImportScreen
        deps={importDeps}
        onClose={() => {
          setImporting(false);
          // Refresh the counts below after an import.
          startup = null;
          start().then((r) => setStatus({ kind: 'done', ...r, recovered: 0 }));
        }}
      />
    );
  }
  const { info, check, recovered } = status;
  return (
    <main className="setup">
      <h1>{check.ok ? 'Atlas is set up' : 'Atlas found a problem'}</h1>
      {recovered > 0 && (
        <p>An import didn't finish last time Atlas was open, so Atlas undid it. Your cards are as they were before it.</p>
      )}
      <dl>
        <dt>Version</dt>
        <dd>{info.version}</dd>
        <dt>Data folder</dt>
        <dd className="path">{info.dataDir}</dd>
        <dt>Database check</dt>
        <dd>{check.integrity === 'ok' ? 'passed' : `failed: ${check.integrity}`}</dd>
        <dt>Scheduler check</dt>
        <dd>{check.schedulerOk ? 'passed' : 'failed'}</dd>
        <dt>Contents</dt>
        <dd>Decks {check.decks} · Notes {check.notes} · Cards {check.cards}</dd>
      </dl>
      <div className="import-actions">
        <button className="primary" onClick={() => setImporting(true)}>Import from Anki…</button>
      </div>
    </main>
  );
}
