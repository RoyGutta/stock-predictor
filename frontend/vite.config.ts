import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is same-origin in production (/api/* is served by the backend on the
// same host). Locally, dev and preview forward /api and /health to the FastAPI
// server so the frontend never needs a hard-coded backend origin.
const backend = { "/api": "http://127.0.0.1:8001", "/health": "http://127.0.0.1:8001" };

export default defineConfig({
  plugins: [react()],
  root: ".", // make sure root is current folder
  server: { proxy: backend },
  preview: { proxy: backend },
});
