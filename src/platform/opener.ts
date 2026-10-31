import { openUrl as open } from '@tauri-apps/plugin-opener';

/** Opens a web page in the default browser (only the releases page is allowed by the capability). */
export function openUrl(url: string): Promise<void> {
  return open(url);
}
