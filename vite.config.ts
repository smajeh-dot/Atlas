/// <reference types="vitest/config" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export interface Licence {
  name: string;
  version: string;
  licence: string;
  text: string;
}

/**
 * Every library and font bundled into the app (the production dependency tree) with its licence text,
 * for Settings → About. Development tools are not included because they are not shipped.
 */
export function collectLicences(root: string): Licence[] {
  const out = new Map<string, Licence>();
  const readPkg = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string; version: string; license?: string | { type?: string }; dependencies?: Record<string, string>;
  };
  const locate = (name: string, from: string): string | null => {
    // npm installs a conflicting version beside the package that needs it, otherwise at the top.
    for (let dir = from; dir.startsWith(root); dir = join(dir, '..', '..')) {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return candidate;
      if (dir === root) break;
    }
    const top = join(root, 'node_modules', name);
    return existsSync(join(top, 'package.json')) ? top : null;
  };
  const visit = (name: string, from: string) => {
    const dir = locate(name, from);
    if (!dir) return;
    const pkg = readPkg(dir);
    const key = `${pkg.name}@${pkg.version}`;
    if (out.has(key)) return;
    const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'See licence text');
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
    out.set(key, { name: pkg.name, version: pkg.version, licence, text: file ? readFileSync(join(dir, file), 'utf8') : `Licensed under ${licence}.` });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  };
  for (const dep of Object.keys(readPkg(root).dependencies ?? {})) visit(dep, root);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function licences(): Plugin {
  const id = 'virtual:atlas-licences';
  return {
    name: 'atlas-licences',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (resolved) => (resolved === `\0${id}` ? `export default ${JSON.stringify(collectLicences(process.cwd()))};` : undefined),
  };
}

export default defineConfig({
  plugins: [react(), licences()],
  // Tauri expects a fixed port and prints its own output.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The bundle loads from inside Atlas.exe, never over a network, so one large chunk is fine.
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The big import test runs on its own: npm run test:scale.
    exclude: ['tests/scale/**', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    // UI tests drive whole screens; GitHub's Windows runners are several times slower than a laptop.
    testTimeout: 20_000,
  },
});
