import { useEffect, useMemo, useState } from 'react';
import { ImportFlow, type ImportStep } from '../../../services/importFlow';
import { useAtlas } from '../../app/AtlasContext';
import { Icon, type IconName } from '../../icons/icons';
import { ImportOverlay } from './ImportOverlay';
import styles from './Notch.module.css';

/** The tab hanging from the top of the Today screen: quick access to the things you reach for most. */
export function Notch() {
  const { deps, navigate } = useAtlas();

  // Import opens the file picker straight away. The card only appears once a file has been chosen, and closing it discards that file.
  // Nothing happens when this build has no importer (tests, browser preview).
  const [step, setStep] = useState<ImportStep>({ kind: 'idle' });
  const flow = useMemo(
    () => (deps.importer ? new ImportFlow({ ...deps.importer, db: deps.db, clock: deps.clock }, setStep) : null),
    [deps],
  );
  useEffect(() => () => void flow?.close(), [flow]);

  // Browse and Shared look active but don't do anything yet.
  const buttons: { label: string; icon: IconName; onClick?: () => void }[] = [
    { label: 'Import', icon: 'import', onClick: () => void flow?.choose() },
    { label: 'Add', icon: 'plus', onClick: () => navigate({ name: 'add' }) },
    { label: 'Browse', icon: 'browse' },
    { label: 'Shared', icon: 'shared' },
  ];
  return (
    <div className={styles.anchor}>
      <div className={styles.notch} role="toolbar" aria-label="Quick actions" data-testid="today-notch">
        {buttons.map((b) => (
          <button key={b.label} type="button" className={styles.button} onClick={b.onClick}>
            <Icon name={b.icon} />
            <span>{b.label}</span>
          </button>
        ))}
      </div>
      {step.kind !== 'idle' && <ImportOverlay onClose={() => void flow?.close()} />}
    </div>
  );
}
