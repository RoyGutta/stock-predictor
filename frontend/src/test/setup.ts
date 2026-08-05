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
