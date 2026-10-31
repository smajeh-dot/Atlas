import { expect, test } from 'vitest';
import { MediaTypeError, mediaNameFor, saveImage, type MediaPort } from '../../src/services/mediaService';

test('identical bytes get the same paste- name; png → .png, jpeg → .jpg', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const a = await mediaNameFor(bytes, 'image/png');
  expect(a).toMatch(/^paste-[0-9a-f]{12}\.png$/);
  expect(a).toBe('paste-7037807198c2.png'); // SHA-1 of 01 02 03 starts 7037807198c2
  expect(await mediaNameFor(bytes, 'image/png')).toBe(a);
  expect(await mediaNameFor(bytes, 'image/jpeg')).toMatch(/\.jpg$/);
  expect(await mediaNameFor(bytes, 'image/gif')).toMatch(/\.gif$/);
  expect(await mediaNameFor(bytes, 'image/webp')).toMatch(/\.webp$/);
});

test('unsupported types are refused with a plain message', async () => {
  await expect(mediaNameFor(new Uint8Array([1]), 'image/bmp')).rejects.toBeInstanceOf(MediaTypeError);
  await expect(mediaNameFor(new Uint8Array([1]), 'image/bmp')).rejects.toThrow('Atlas can add PNG, JPEG, GIF and WebP images.');
});

test('saveImage writes through the port and returns the bare name', async () => {
  const writes: [string, Uint8Array][] = [];
  const port: MediaPort = { url: (n) => `media://${n}`, write: async (n, b) => void writes.push([n, b]) };
  const bytes = new Uint8Array([9, 9]);
  const name = await saveImage(port, bytes, 'image/png');
  expect(writes).toEqual([[name, bytes]]);
  expect(name).toMatch(/^paste-[0-9a-f]{12}\.png$/);
});
