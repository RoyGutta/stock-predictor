/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the Stock Predictor API.
   * Anything prefixed VITE_ is compiled into the browser bundle and is public —
   * never put a secret here.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
