import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './Toast.module.css';

export interface ToastSpec {
  message: string;
  action?: { label: string; onClick(): void };
}

interface ToastApi {
  show(t: ToastSpec): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const PLAIN_MS = 4000;
const ACTION_MS = 8000;

/** One toast at a time (spec 9): a new one replaces the old. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);
  const show = useCallback((t: ToastSpec) => {
    clearTimeout(timer.current);
    counter.current += 1;
    setToast({ ...t, id: counter.current });
    timer.current = setTimeout(() => setToast(null), t.action ? ACTION_MS : PLAIN_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div role="status" aria-live="polite" className={styles.region}>
        {toast && (
          <div key={toast.id} className={styles.toast}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  clearTimeout(timer.current);
                  setToast(null);
                  toast.action!.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v;
}
