import { useState } from 'react';
import { useAtlas } from '../../app/AtlasContext';
import { Icon, type IconName } from '../../icons/icons';
import { ImportOverlay } from './ImportOverlay';
import styles from './Notch.module.css';

/** The tab hanging from the top of the Today screen: quick access to the things you reach for most. */
export function Notch() {
  const { navigate } = useAtlas();
  const [importing, setImporting] = useState(false);
  // Browse and Shared look active but don't do anything yet. Import opens a blank card for now.
  const buttons: { label: string; icon: IconName; onClick?: () => void }[] = [
    { label: 'Import', icon: 'import', onClick: () => setImporting(true) },
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
      {importing && <ImportOverlay onClose={() => setImporting(false)} />}
    </div>
  );
}
