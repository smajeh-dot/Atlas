import { useMemo, useState } from 'react';
import type { ImportProgress } from '../../../import/commit';
import type { ImportReport, ImportWarning } from '../../../import/report';
import { ImportFlow, type ImportFlowDeps, type ImportStep } from '../../../services/importFlow';
import { Button } from '../../components/Button';
import { ProgressBar } from '../../components/ProgressBar';
import styles from './ImportScreen.module.css';

const STAGES: Record<ImportProgress['stage'], { label: string; from: number; to: number }> = {
  backup: { label: 'Backing up your cards…', from: 0, to: 0.05 },
  setup: { label: 'Getting ready…', from: 0.05, to: 0.1 },
  media: { label: 'Copying pictures and sounds…', from: 0.1, to: 0.2 },
  notes: { label: 'Importing notes…', from: 0.2, to: 0.95 },
  checking: { label: 'Checking everything…', from: 0.95, to: 1 },
};

function fraction(p: ImportProgress): number {
  const s = STAGES[p.stage];
  const within = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return s.from + (s.to - s.from) * within;
}

const n = (x: number) => x.toLocaleString('en-GB');

function Counts({ rows }: { rows: [string, number][] }) {
  return (
    <dl className={styles.counts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{n(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Warnings({ warnings }: { warnings: ImportWarning[] }) {
  if (!warnings.length) return null;
  return (
    <ul className={styles.warnings}>
      {warnings.map((w) => (
        <li key={w.code}>
          {w.message}
          {w.examples.length > 0 && <span className={styles.muted}> For example: {w.examples.join('; ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function Report({ report }: { report: ImportReport }) {
  const { imported: i, skipped: s } = report;
  return (
    <>
      <Counts rows={[['Decks', i.decks], ['Notes', i.notes], ['Cards', i.cards], ['Reviews', i.reviews], ['Pictures and sounds', i.media]]} />
      {s.existingNotes > 0 && <p>{n(s.existingNotes)} notes were already in Atlas and were left as they were, progress and all.</p>}
      {report.updatedNotes > 0 && <p>{n(report.updatedNotes)} of those had their text updated from the file.</p>}
      {s.cardsWithNoContent > 0 && (
        <p>{n(s.cardsWithNoContent)} cards had nothing to show and were skipped, with their {n(s.reviewsForSkippedCards)} reviews.</p>
      )}
      {report.estimated > 0 && (
        <p>{n(report.estimated)} cards had no review history in the file, so Atlas estimated how well you know them. Their due dates are Anki's.</p>
      )}
      <Warnings warnings={report.warnings} />
      {report.backupPath && (
        <p className={styles.muted}>Before importing, Atlas saved a copy of your cards at <span className={styles.path}>{report.backupPath}</span>.</p>
      )}
    </>
  );
}

/** Choose an Anki file, preview it, import it with progress and Cancel, then read the report. */
export function ImportScreen({ deps, onClose }: { deps: ImportFlowDeps; onClose(): void }) {
  const [step, setStep] = useState<ImportStep>({ kind: 'idle' });
  const [update, setUpdate] = useState(false);
  const flow = useMemo(() => new ImportFlow(deps, setStep), [deps]);

  const close = async () => {
    await flow.close();
    onClose();
  };

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <h1 className={styles.title}>Import from Anki</h1>

        {step.kind === 'idle' && (
          <>
            <p className={styles.lead}>
              In Anki, choose <b>File → Export</b>, pick <b>Anki Deck Package (.apkg)</b>, tick <b>Include scheduling information</b> and{' '}
              <b>Include media</b>, and save the file. Then choose it here.
            </p>
            <div className={styles.actions}>
              <Button variant="primary" icon="import" onClick={() => void flow.choose()}>Choose a file…</Button>
              <Button variant="ghost" onClick={() => void close()}>Back</Button>
            </div>
          </>
        )}

        {step.kind === 'reading' && <p aria-live="polite">Reading {step.fileName}…</p>}

        {step.kind === 'preview' && (
          <>
            <p className={styles.file}>{step.fileName}</p>
            <Counts rows={[
              ['Notes', step.preview.counts.notes], ['Cards', step.preview.counts.cards],
              ['Reviews', step.preview.counts.reviews], ['Pictures and sounds', step.preview.counts.media],
            ]} />
            {step.preview.hasScheduling && <p>Your progress comes with it: cards will be due when Anki would have shown them.</p>}
            {step.preview.existingNotes > 0 && (
              <p>{n(step.preview.existingNotes)} of these notes are already in Atlas. They'll be left as they are; your progress on them always wins.</p>
            )}
            {step.preview.newDecks.length > 0 && (
              <p>
                New decks: {step.preview.newDecks.slice(0, 8).join(', ')}
                {step.preview.newDecks.length > 8 ? `, and ${step.preview.newDecks.length - 8} more` : ''}.
              </p>
            )}
            <Warnings warnings={step.preview.warnings} />
            {step.preview.existingNotes > 0 && (
              <label className={styles.option}>
                <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
                Also update the text of notes I already have (never their progress)
              </label>
            )}
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void flow.start({ updateExisting: update })}>Import</Button>
              <Button variant="ghost" onClick={() => void close()}>Cancel</Button>
            </div>
          </>
        )}

        {step.kind === 'importing' && (
          <>
            <p className={styles.file}>{step.fileName}</p>
            <ProgressBar value={fraction(step.progress)} label="Import progress" />
            <p aria-live="polite">
              {step.cancelling
                ? 'Cancelling and undoing what was imported…'
                : step.progress.stage === 'notes'
                  ? `Importing notes… ${n(step.progress.done)} of ${n(step.progress.total)}`
                  : STAGES[step.progress.stage].label}
            </p>
            <div className={styles.actions}>
              <Button onClick={() => flow.cancel()} disabled={step.cancelling}>Cancel</Button>
            </div>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <p className={styles.file}>Imported {step.fileName}</p>
            <Report report={step.report} />
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void close()}>Done</Button>
            </div>
          </>
        )}

        {step.kind === 'failed' && (
          <>
            {step.fileName && <p className={styles.file}>{step.fileName}</p>}
            <p className={step.cancelled ? undefined : styles.problem}>{step.message}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void flow.choose()}>Choose a file…</Button>
              <Button variant="ghost" onClick={() => void close()}>Back</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
