import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend dev server. Proxying avoids CORS config on FastAPI and lets the
// frontend use relative paths (e.g. fetch("/readings/...")), which also work
// unchanged behind nginx in production (Phase 9).
const BACKEND = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/readings": { target: BACKEND, changeOrigin: true },
      "/forecast": { target: BACKEND, changeOrigin: true },
      "/alerts": { target: BACKEND, changeOrigin: true },
      "/chat": { target: BACKEND, changeOrigin: true },
      "/drains": { target: BACKEND, changeOrigin: true },
      "/health": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
      "/tts": { target: BACKEND, changeOrigin: true },
      "/n8n": { target: BACKEND, changeOrigin: true },
      "/ai": { target: BACKEND, changeOrigin: true },
      "/reports": { target: BACKEND, changeOrigin: true },
      "/methane": { target: BACKEND, changeOrigin: true },
      "/simulate": { target: BACKEND, changeOrigin: true },
      "/model": { target: BACKEND, changeOrigin: true },
    },
  },
});
