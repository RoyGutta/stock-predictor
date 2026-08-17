import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    css: false,
    /**
     * Well above the ~1s these tests actually need.
     *
     * TENSIONS T-5: at the 5s default the suite fails intermittently when dev
     * servers or a browser are competing for CPU, producing a different result
     * on each run. The standing mitigation (CHANGELOG SM-2, stop servers before
     * verifying) depends on remembering to do it, and it was missed again once
     * the suite grew past 150 tests and added axe, which is slow.
     *
     * A generous timeout costs nothing on a passing run — it only bounds how
     * long a genuine hang takes to surface — and it removes the failure mode
     * rather than relying on a manual step. The instruction to stop servers
     * still stands; this stops a missed step from producing a false red.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
