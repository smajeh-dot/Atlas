// Study-day tests are written against UK wall-clock time, including the October clock change.
process.env.TZ = 'Europe/London';

// jsdom lacks a few browser APIs that the UI and ProseMirror touch.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= rect;
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint ??= () => null;
  // jsdom has no DragEvent; without it drag events lose their mouse position.
  window.DragEvent ??= class DragEvent extends MouseEvent {
    readonly dataTransfer: DataTransfer | null = null;
  } as unknown as typeof DragEvent;
}

if (typeof window !== 'undefined') {
  const { afterEach, vi } = await import('vitest');
  const { cleanup, configure } = await import('@testing-library/react');
  // findBy/waitFor default to 1 s, too tight for screens on slow CI runners.
  configure({ asyncUtilTimeout: 5000 });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
}

export {};
