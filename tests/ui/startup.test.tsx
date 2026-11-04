// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('../../src/platform/tauriDb', () => ({
  tauriDb: { query: vi.fn(), execute: vi.fn(), batch: vi.fn() },
  getAppInfo: async () => ({ dataDir: '', dbPath: '', version: '0.2.0', startupError: "Atlas couldn't create C:\\Users\\sam\\AppData\\Roaming\\Atlas\\media: Access is denied." }),
}));
vi.mock('../../src/platform/media', () => ({ tauriMedia: { url: (n: string) => n, write: async () => {} } }));
vi.mock('../../src/platform/opener', () => ({ openUrl: async () => {} }));

test('a start-up error shows a message instead of an empty window', async () => {
  const { App } = await import('../../src/App');
  render(<App />);
  expect(await screen.findByRole('heading', { name: "Atlas couldn't open your data" })).toBeTruthy();
  expect(screen.getByText(/Access is denied\./)).toBeTruthy();
  expect(screen.getByText(/Check that you can open %APPDATA%\\Atlas in File Explorer, then reopen Atlas\./)).toBeTruthy();
});
