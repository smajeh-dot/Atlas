// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { applyTheme, ThemeProvider, useTheme } from '../../src/ui/theme/ThemeProvider';

function Switcher() {
  const { theme, setTheme } = useTheme();
  return <button onClick={() => void setTheme('tangerine')}>{theme}</button>;
}

test('applyTheme sets data-theme on <html>', () => {
  applyTheme('workbench');
  expect(document.documentElement.dataset.theme).toBe('workbench');
});

test('setTheme switches data-theme instantly and saves', async () => {
  const onSave = vi.fn(async () => {});
  render(<ThemeProvider theme="workbench" onSave={onSave}><Switcher /></ThemeProvider>);
  await act(async () => screen.getByRole('button').click());
  expect(document.documentElement.dataset.theme).toBe('tangerine');
  expect(screen.getByRole('button')).toHaveProperty('textContent', 'tangerine');
  expect(onSave).toHaveBeenCalledWith({ theme: 'tangerine' });
});
