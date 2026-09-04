import '@testing-library/jest-dom';

/**
 * jsdom implements neither of these, and both are load-bearing in the guest
 * flow: the upload page measures scroll behaviour and the gallery uses an
 * intersection observer for lazy loading. Without stubs the component throws
 * on mount and the test failure points at the wrong thing.
 */
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (!window.scrollTo) {
    window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
  }

  // Assigned through an index signature rather than `window.X`: TypeScript
  // knows `IntersectionObserver` is on `Window` from lib.dom, so an `in` guard
  // narrows the false branch to `never` and the assignment stops compiling.
  const globals = window as unknown as Record<string, unknown>;
  if (!globals.IntersectionObserver) {
    class StubIntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: ReadonlyArray<number> = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    globals.IntersectionObserver = StubIntersectionObserver;
  }
}
