import { useAtlas } from '../../app/AtlasContext';
import { Icon, type IconName } from '../../icons/icons';
import styles from './Notch.module.css';

/** The tab hanging from the top of the Today screen: quick access to the things you reach for most. */
export function Notch() {
  const { deps, navigate } = useAtlas();
  // Browse and Shared look active but don't do anything yet. Import does nothing when this build has no importer (tests, browser preview).
  const buttons: { label: string; icon: IconName; onClick?: () => void }[] = [
    { label: 'Import', icon: 'import', onClick: deps.importer ? () => navigate({ name: 'import' }) : undefined },
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
    </div>
  );
}
