import { useEffect, useState } from 'react';
import { migrate } from './data/migrations';
import { getAppInfo, tauriDb, type AppInfo } from './platform/tauriDb';
import { systemClock } from './platform/clock';
import { runSelfCheck, type SelfCheckResult } from './services/selfCheck';
import './App.css';

type Status =
  | { kind: 'checking' }
  | { kind: 'done'; info: AppInfo; check: SelfCheckResult }
  | { kind: 'error'; message: string };

// Started once per page load so a double-mounted effect never migrates twice at the same time.
let startup: Promise<{ info: AppInfo; check: SelfCheckResult }> | null = null;
function start() {
  startup ??= (async () => {
    const info = await getAppInfo();
    await migrate(tauriDb, systemClock.now());
    return { info, check: await runSelfCheck(tauriDb, systemClock.now()) };
  })();
  return startup;
}

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

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
  const { info, check } = status;
  return (
    <main className="setup">
      <h1>{check.ok ? 'Atlas is set up' : 'Atlas found a problem'}</h1>
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
    </main>
  );
}
