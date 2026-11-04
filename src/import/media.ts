/**
 * Media decisions for an import. Pure: the Rust side copies the files.
 *
 * - Same name (ignoring case) and same content as a file Atlas already has:
 *   reuse it, copy nothing.
 * - Same name, different content: install as "<stem>-<first 8 of sha1><ext>"
 *   and rewrite this import's references to the new name.
 * - The package reader may already have renamed a file to make it safe on
 *   Windows; references to its original name are rewritten too.
 */

export interface StagedMedia {
  name: string;
  originalName: string;
  sha1: string;
  size: number;
  stagedPath: string;
}

export interface ExistingMedia {
  name: string;
  sha1: string;
}

export interface MediaInstall {
  stagedPath: string;
  name: string;
  sha1: string;
  size: number;
}

export interface MediaPlan {
  /** Files to copy into the media folder, with the names they get there. */
  install: MediaInstall[];
  /** Name as written in the notes → the name Atlas will serve. Only entries that change. */
  renames: Map<string, string>;
  /** Every name a reference may use and still find its file (lower case, NFC). */
  known: Set<string>;
  /** Files renamed because a different file already had the name. */
  renamedForCollision: string[];
}

export const mediaKey = (name: string) => name.normalize('NFC').toLowerCase();

function withHash(name: string, sha1: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${stem}-${sha1.slice(0, 8)}${ext}`;
}

export function planMedia(staged: StagedMedia[], existing: ExistingMedia[]): MediaPlan {
  const taken = new Map(existing.map((m) => [mediaKey(m.name), m]));
  const plan: MediaPlan = { install: [], renames: new Map(), known: new Set(taken.keys()), renamedForCollision: [] };
  for (const m of staged) {
    let name = m.name;
    let other = taken.get(mediaKey(name));
    if (other && other.sha1 !== m.sha1) {
      name = withHash(m.name, m.sha1);
      other = taken.get(mediaKey(name));
      plan.renamedForCollision.push(m.originalName);
    }
    if (!other) {
      plan.install.push({ stagedPath: m.stagedPath, name, sha1: m.sha1, size: m.size });
      taken.set(mediaKey(name), { name, sha1: m.sha1 });
    } else if (other.sha1 !== m.sha1) {
      // Even the hashed name is taken by different bytes; only a hash collision gets here.
      throw new Error(`Media name ${name} is taken by a different file`);
    }
    const served = other ? other.name : name;
    if (served !== m.originalName) plan.renames.set(m.originalName, served);
    plan.known.add(mediaKey(m.originalName));
    plan.known.add(mediaKey(served));
  }
  return plan;
}

/** For each element and attribute that can name a file: double-quoted, single-quoted and bare values. */
function attributePatterns(tag: string, attr: string): RegExp[] {
  const head = `(<${tag}\\b[^>]*?\\b${attr}\\s*=\\s*`;
  return [
    new RegExp(`${head}")([^"]+)(?=")`, 'gi'),
    new RegExp(`${head}')([^']+)(?=')`, 'gi'),
    new RegExp(`${head})([^\\s"'>]+)`, 'gi'),
  ];
}

// Each pattern captures the text before the filename as group 1 and the filename as group 2.
const REFERENCE_PATTERNS: RegExp[] = [
  ...attributePatterns('img', 'src'),
  ...attributePatterns('source', 'src'),
  ...attributePatterns('audio', 'src'),
  ...attributePatterns('video', 'src'),
  ...attributePatterns('object', 'data'),
  /(\[sound:)([^\]]+)(?=\])/gi,
  /(url\(\s*["']?)([^"')]+?)(?=["']?\s*\))/gi,
];

/** Remote links and inline data aren't files in the media folder. */
function isLocal(ref: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
}

/** Every local media filename an HTML field, template or stylesheet refers to. */
export function mediaReferences(html: string): string[] {
  const out = new Set<string>();
  for (const re of REFERENCE_PATTERNS) {
    for (const m of html.matchAll(re)) {
      const ref = decodeRef(m[2]!);
      if (isLocal(ref)) out.add(ref);
    }
  }
  return [...out];
}

/** Anki writes names into HTML with &amp; and friends escaped. */
function decodeRef(ref: string): string {
  return ref.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function encodeRef(name: string): string {
  return name.replace(/&/g, '&amp;');
}

/** Rewrites references to renamed files; leaves everything else exactly as it was. */
export function rewriteReferences(html: string, renames: Map<string, string>): string {
  if (!renames.size) return html;
  let out = html;
  for (const re of REFERENCE_PATTERNS) {
    out = out.replace(re, (all, before: string, ref: string) => {
      const to = renames.get(decodeRef(ref));
      return to === undefined ? all : `${before}${ref.includes('&amp;') ? encodeRef(to) : to}`;
    });
  }
  return out;
}
