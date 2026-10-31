import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));

test('CSP is strict: no inline or remote scripts, no remote images', () => {
  const csp: string = conf.app.security.csp;
  const directive = (n: string) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' '))!;
  expect(directive('script-src')).toBe("script-src 'self'");
  expect(directive('default-src')).toBe("default-src 'self'");
  expect(directive('img-src')).not.toMatch(/https?:\/\/(?!media\.localhost)/);
  expect(directive('connect-src')).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-src 'none'");
});

test('versions match across package.json, tauri.conf.json and Cargo.toml', () => {
  const pkg = JSON.parse(read('package.json')).version;
  const cargo = /^version = "(.+)"/m.exec(read('src-tauri/Cargo.toml'))![1];
  expect([conf.version, cargo]).toEqual([pkg, pkg]);
});

test('opener may only open the releases page', () => {
  const cap = JSON.parse(read('src-tauri/capabilities/default.json'));
  const opener = cap.permissions.filter((p: unknown) => JSON.stringify(p).includes('opener'));
  expect(opener.length).toBeGreaterThan(0);
  expect(JSON.stringify(opener)).toContain('https://github.com/smajeh-dot/atlas/releases');
  expect(JSON.stringify(opener)).not.toMatch(/"(opener:default|\*)"/);
});

test('the workflow refuses a tag that does not match the app version', () => {
  const wf = read('.github/workflows/release.yml');
  expect(wf).toMatch(/does not match/);
  expect(wf).toMatch(/tauri\.conf\.json/);
});
