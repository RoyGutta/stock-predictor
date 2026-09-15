import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Testing Library only auto-registers cleanup when Vitest globals are enabled.
 * We keep `globals: false` so every test imports what it uses, which means
 * unmounting is ours to do — without it each render leaves its DOM behind and
 * queries start matching elements from earlier tests.
 */
afterEach(cleanup);

// jsdom has no matchMedia; the theme hook reads the OS color-scheme through it.
// A stub that reports "no preference" lets the full App render in tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
