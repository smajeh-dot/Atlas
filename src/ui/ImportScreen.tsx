import { useMemo, useState } from 'react';
import type { ImportProgress } from '../import/commit';
import type { ImportReport, ImportWarning } from '../import/report';
import { ImportFlow, type ImportFlowDeps, type ImportStep } from '../services/importFlow';
import './ImportScreen.css';

const STAGES: Record<ImportProgress['stage'], { label: string; from: number; to: number }> = {
  backup: { label: 'Backing up your cards…', from: 0, to: 5 },
  setup: { label: 'Getting ready…', from: 5, to: 10 },
  media: { label: 'Copying pictures and sounds…', from: 10, to: 20 },
  notes: { label: 'Importing notes…', from: 20, to: 95 },
  checking: { label: 'Checking everything…', from: 95, to: 100 },
};

function percent(p: ImportProgress): number {
  const s = STAGES[p.stage];
  const within = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return Math.round(s.from + (s.to - s.from) * within);
}

const n = (x: number) => x.toLocaleString('en-GB');

function Warnings({ warnings }: { warnings: ImportWarning[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="import-warnings">
      {warnings.map((w) => (
        <li key={w.code}>
          {w.message}
          {w.examples.length > 0 && <span className="import-examples"> For example: {w.examples.join('; ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function Report({ report }: { report: ImportReport }) {
  const { imported: i, skipped: s } = report;
  return (
    <>
      <dl className="import-counts">
        <dt>Decks</dt><dd>{n(i.decks)}</dd>
        <dt>Notes</dt><dd>{n(i.notes)}</dd>
        <dt>Cards</dt><dd>{n(i.cards)}</dd>
        <dt>Reviews</dt><dd>{n(i.reviews)}</dd>
        <dt>Pictures and sounds</dt><dd>{n(i.media)}</dd>
      </dl>
      {s.existingNotes > 0 && <p>{n(s.existingNotes)} notes were already in Atlas and were left as they were, progress and all.</p>}
      {report.updatedNotes > 0 && <p>{n(report.updatedNotes)} of those had their text updated from the file.</p>}
      {s.cardsWithNoContent > 0 && (
        <p>{n(s.cardsWithNoContent)} cards had nothing to show and were skipped, with their {n(s.reviewsForSkippedCards)} reviews.</p>
      )}
      {report.estimated > 0 && (
        <p>{n(report.estimated)} cards had no review history in the file, so Atlas estimated how well you know them. Their due dates are Anki's.</p>
      )}
      <Warnings warnings={report.warnings} />
      {report.backupPath && <p className="import-quiet">Before importing, Atlas saved a copy of your cards at <span className="path">{report.backupPath}</span>.</p>}
    </>
  );
}

export function ImportScreen({ deps, onClose }: { deps: ImportFlowDeps; onClose(): void }) {
  const [step, setStep] = useState<ImportStep>({ kind: 'idle' });
  const [update, setUpdate] = useState(false);
  const flow = useMemo(() => new ImportFlow(deps, setStep), [deps]);

  const close = async () => {
    await flow.close();
    onClose();
  };

  return (
    <main className="setup import">
      <h1>Import from Anki</h1>

      {step.kind === 'idle' && (
        <>
          <p>In Anki, choose <b>File → Export</b>, pick <b>Anki Deck Package (.apkg)</b>, tick <b>Include scheduling information</b> and <b>Include media</b>, and save the file. Then choose it here.</p>
          <div className="import-actions">
            <button className="primary" onClick={() => void flow.choose()}>Choose a file…</button>
            <button onClick={() => void close()}>Back</button>
          </div>
        </>
      )}

      {step.kind === 'reading' && <p aria-live="polite">Reading {step.fileName}…</p>}

      {step.kind === 'preview' && (
        <>
          <p className="import-file">{step.fileName}</p>
          <dl className="import-counts">
            <dt>Notes</dt><dd>{n(step.preview.counts.notes)}</dd>
            <dt>Cards</dt><dd>{n(step.preview.counts.cards)}</dd>
            <dt>Reviews</dt><dd>{n(step.preview.counts.reviews)}</dd>
            <dt>Pictures and sounds</dt><dd>{n(step.preview.counts.media)}</dd>
          </dl>
          {step.preview.hasScheduling && <p>Your progress comes with it: cards will be due when Anki would have shown them.</p>}
          {step.preview.existingNotes > 0 && (
            <p>{n(step.preview.existingNotes)} of these notes are already in Atlas. They'll be left as they are; your progress on them always wins.</p>
          )}
          {step.preview.newDecks.length > 0 && (
            <p>New decks: {step.preview.newDecks.slice(0, 8).join(', ')}{step.preview.newDecks.length > 8 ? `, and ${step.preview.newDecks.length - 8} more` : ''}.</p>
          )}
          <Warnings warnings={step.preview.warnings} />
          {step.preview.existingNotes > 0 && (
            <label className="import-option">
              <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
              Also update the text of notes I already have (never their progress)
            </label>
          )}
          <div className="import-actions">
            <button className="primary" onClick={() => void flow.start({ updateExisting: update })}>Import</button>
            <button onClick={() => void close()}>Cancel</button>
          </div>
        </>
      )}

      {step.kind === 'importing' && (
        <>
          <p className="import-file">{step.fileName}</p>
          <div className="import-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(step.progress)}>
            <div style={{ width: `${percent(step.progress)}%` }} />
          </div>
          <p aria-live="polite">
            {step.cancelling
              ? 'Cancelling and undoing what was imported…'
              : step.progress.stage === 'notes'
                ? `Importing notes… ${n(step.progress.done)} of ${n(step.progress.total)}`
                : STAGES[step.progress.stage].label}
          </p>
          <div className="import-actions">
            <button onClick={() => flow.cancel()} disabled={step.cancelling}>Cancel</button>
          </div>
        </>
      )}

      {step.kind === 'done' && (
        <>
          <p className="import-file">Imported {step.fileName}</p>
          <Report report={step.report} />
          <div className="import-actions">
            <button className="primary" onClick={() => void close()}>Done</button>
          </div>
        </>
      )}

      {step.kind === 'failed' && (
        <>
          {step.fileName && <p className="import-file">{step.fileName}</p>}
          <p className={step.cancelled ? '' : 'problem'}>{step.message}</p>
          <div className="import-actions">
            <button className="primary" onClick={() => void flow.choose()}>Choose a file…</button>
            <button onClick={() => void close()}>Back</button>
          </div>
        </>
      )}
    </main>
  );
}
