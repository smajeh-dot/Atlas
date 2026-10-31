import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/icons';
import styles from './IconButton.module.css';
import { ariaKeys } from './Kbd';
import { Tooltip } from './Tooltip';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  shortcut?: string;
}

export function IconButton({ icon, label, shortcut, className, type = 'button', ...rest }: Props) {
  return (
    <Tooltip text={label} shortcut={shortcut}>
      <button
        type={type}
        aria-label={label}
        aria-keyshortcuts={shortcut ? ariaKeys(shortcut) : undefined}
        className={[styles.button, className].filter(Boolean).join(' ')}
        {...rest}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}
