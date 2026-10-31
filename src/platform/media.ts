import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { MediaPort } from '../services/mediaService';

export const tauriMedia: MediaPort = {
  url: (name) => convertFileSrc(name, 'media'),
  // Sent as a raw body so large images are not encoded as JSON number arrays.
  write: async (name, bytes) => {
    try {
      await invoke('media_write', bytes, { headers: { 'x-media-name': name } });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  },
};
