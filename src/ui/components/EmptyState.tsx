import { Button } from './Button';
import styles from './EmptyState.module.css';

export function EmptyState({ title, text, action }: { title: string; text: string; action?: { label: string; onClick(): void; kbd?: string } }) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.text}>{text}</p>
      {action && <Button variant="primary" kbd={action.kbd} onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
