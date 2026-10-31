import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/icons';
import styles from './Button.module.css';
import { ariaKeys, Kbd } from './Kbd';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  kbd?: string;
}

export function Button({ variant = 'secondary', size = 'md', icon, kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(' ')}
      aria-keyshortcuts={kbd ? ariaKeys(kbd) : undefined}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      <span className={styles.label}>{children}</span>
      {kbd && <span aria-hidden="true"><Kbd>{kbd}</Kbd></span>}
    </button>
  );
}
