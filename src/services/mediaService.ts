/** Where card media lives. The app writes through Tauri; tests use an in-memory fake. */
export interface MediaPort {
  /** URL the webview can load for a bare media file name. */
  url(name: string): string;
  write(name: string, bytes: Uint8Array): Promise<void>;
}

export class MediaTypeError extends Error {}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** `paste-<first 12 hex of SHA-1>.<ext>` (spec 5): the same image always gets the same name, so it is stored once. */
export async function mediaNameFor(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = EXTENSIONS[mime.toLowerCase()];
  if (!ext) throw new MediaTypeError('Atlas can add PNG, JPEG, GIF and WebP images.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes as BufferSource));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `paste-${hex.slice(0, 12)}.${ext}`;
}

export async function saveImage(media: MediaPort, bytes: Uint8Array, mime: string): Promise<string> {
  const name = await mediaNameFor(bytes, mime);
  await media.write(name, bytes);
  return name;
}
