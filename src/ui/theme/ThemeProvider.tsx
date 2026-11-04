import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Settings } from '../../core/model';
import './tokens.css';
import './workbench.css';

type Theme = Settings['theme'];

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeValue {
  theme: Theme;
  setTheme(t: Theme): Promise<void>;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/** Switching is instant: the attribute changes first, then the choice is saved. */
export function ThemeProvider({ theme: initial, onSave, children }: {
  theme: Theme;
  onSave(patch: { theme: Theme }): Promise<void>;
  children: ReactNode;
}) {
  const [theme, setState] = useState<Theme>(initial);
  const setTheme = useCallback(async (t: Theme) => {
    applyTheme(t);
    setState(t);
    await onSave({ theme: t });
  }, [onSave]);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
