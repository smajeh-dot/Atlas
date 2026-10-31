// Browser dev mode for machines that cannot build the Rust app (no C++ build tools).
// Runs the real UI in a normal browser with Vite's instant updates, and answers the Rust commands
// from Node instead. It uses its own database in ~/.atlas-dev, never the real Atlas folder.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { mergeConfig, type Plugin } from 'vite';
import base from '../vite.config.ts';

const dataDir = join(homedir(), '.atlas-dev');
const mediaDir = join(dataDir, 'media');
mkdirSync(mediaDir, { recursive: true });

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const db = new DatabaseSync(join(dataDir, 'atlas.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const bind = (ps: unknown[] = []) =>
  ps.map((p) => (typeof p === 'boolean' ? (p ? 1n : 0n) : typeof p === 'number' && Number.isInteger(p) ? BigInt(p) : (p ?? null))) as never[];
const plain = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

type Json = { cmd: string; args: { sql: string; params?: unknown[]; statements?: { sql: string; params?: unknown[] }[] } };

function rpc({ cmd, args }: Json): unknown {
  if (cmd === 'db_query') return db.prepare(args.sql).all(...bind(args.params)).map(plain);
  if (cmd === 'db_execute') {
    const r = db.prepare(args.sql).run(...bind(args.params));
    return { changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }
  if (cmd === 'db_batch') {
    db.exec('BEGIN');
    try {
      for (const s of args.statements ?? []) db.prepare(s.sql).run(...bind(s.params));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return null;
  }
  if (cmd === 'app_info') {
    return { dataDir, dbPath: join(dataDir, 'atlas.db'), version: '0.2.0 (browser dev)', startupError: null };
  }
  throw new Error(`Unknown command ${cmd}`);
}

// Stands in for window.__TAURI_INTERNALS__, which only exists inside Atlas.exe.
const shim = `
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args, options) => {
    if (cmd === 'media_write') {
      const name = options && options.headers && options.headers['x-media-name'];
      const r = await fetch('/__media', { method: 'POST', headers: { 'x-media-name': name }, body: args });
      if (!r.ok) throw await r.text();
      return null;
    }
    if (cmd.startsWith('plugin:opener|')) { window.open(args.url, '_blank'); return null; }
    if (cmd.startsWith('plugin:')) return null;
    const r = await (await fetch('/__rpc', { method: 'POST', body: JSON.stringify({ cmd, args }) })).json();
    if (!r.ok) throw r.err;
    return r.out;
  },
  convertFileSrc: (name) => '/__media/' + encodeURIComponent(name),
};`;

const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const safeName = (n: string) => n.length > 0 && !n.startsWith('.') && !/[\\/:\0]/.test(n);

function tauriStandIn(): Plugin {
  return {
    name: 'tauri-stand-in',
    transformIndexHtml: () => [{ tag: 'script', children: shim, injectTo: 'head-prepend' }],
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (req.method === 'POST' && url === '/__rpc') {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            let out: { ok: boolean; out?: unknown; err?: string };
            try {
              out = { ok: true, out: rpc(JSON.parse(Buffer.concat(chunks).toString())) };
            } catch (e) {
              out = { ok: false, err: e instanceof Error ? e.message : String(e) };
            }
            res.setHeader('content-type', 'application/json').end(JSON.stringify(out));
          });
          return;
        }
        if (req.method === 'POST' && url === '/__media') {
          const name = String(req.headers['x-media-name'] ?? '');
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            if (!safeName(name)) return void res.writeHead(400).end('Bad media name');
            if (!existsSync(join(mediaDir, name))) writeFileSync(join(mediaDir, name), Buffer.concat(chunks));
            res.writeHead(200).end();
          });
          return;
        }
        if (req.method === 'GET' && url.startsWith('/__media/')) {
          const name = decodeURIComponent(url.slice('/__media/'.length).split('?')[0]);
          const file = join(mediaDir, name);
          if (!safeName(name) || !existsSync(file)) return void res.writeHead(404).end();
          res.writeHead(200, { 'content-type': types[extname(name).toLowerCase()] ?? 'application/octet-stream' }).end(readFileSync(file));
          return;
        }
        next();
      });
    },
  };
}

export default mergeConfig(base, {
  plugins: [tauriStandIn()],
  clearScreen: false,
  // Not 1420, so it can sit beside a real `tauri dev` if one ever runs.
  server: { port: 1421, strictPort: true, open: true },
});
