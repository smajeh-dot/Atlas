import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import styles from './Input.module.css';

interface Common {
  label?: string;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  error?: string | null;
  hint?: string;
}

function Field({ id, label, hideLabel, error, hint, children }: Common & { id: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      {label && <label htmlFor={id} className={hideLabel ? styles.hidden : styles.label}>{label}</label>}
      {children}
      {hint && !error && <p className={styles.hint}>{hint}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(function Input(
  { label, hideLabel, error, hint, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field id={inputId} label={label} hideLabel={hideLabel} error={error} hint={hint}>
      <input ref={ref} id={inputId} aria-invalid={error ? true : undefined} className={[styles.input, className].filter(Boolean).join(' ')} {...rest} />
    </Field>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { label, hideLabel, error, hint, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field id={inputId} label={label} hideLabel={hideLabel} error={error} hint={hint}>
      <textarea ref={ref} id={inputId} aria-invalid={error ? true : undefined} className={[styles.input, className].filter(Boolean).join(' ')} {...rest} />
    </Field>
  );
});
