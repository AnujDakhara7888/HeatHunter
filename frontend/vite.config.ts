import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The dev server proxies the FastAPI backend; production builds are served by
// FastAPI itself (backend/app/main.py mounts frontend/dist) for offline demos.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
    fs: { allow: [".."] },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
});
