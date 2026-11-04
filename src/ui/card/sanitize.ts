import DOMPurify from 'dompurify';

/** A plain media file name (spec 5: fields refer to media by bare name), never a path or URL. */
const BARE_NAME = /^[^/\\:?#]+$/;
const DATA_IMAGE = /^data:image\//i;
const REMOTE_URL = /url\(\s*(?!['"]?data:)[^)]*\)/gi;

function safeSource(v: string): boolean {
  const s = v.trim();
  return DATA_IMAGE.test(s) || (BARE_NAME.test(s) && !s.startsWith('.'));
}

let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Card content must never navigate, load remote files or reach outside the media folder.
    for (const attr of ['href', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background']) node.removeAttribute(attr);
    const src = node.getAttribute('src');
    if (src !== null && !safeSource(src)) node.removeAttribute('src');
    const style = node.getAttribute('style');
    if (style !== null && REMOTE_URL.test(style)) node.setAttribute('style', style.replace(REMOTE_URL, ''));
  });
}

/** Spec 6.8: scripts, frames, event handlers and remote URLs are removed; bare media names and data: images survive. */
export function sanitizeCardHtml(html: string): string {
  hook();
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'link', 'meta', 'base', 'noscript', 'template'],
    FORBID_ATTR: ['name'],
    ALLOW_DATA_ATTR: true,
  });
}
