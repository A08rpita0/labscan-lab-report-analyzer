import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The production build is written straight into ../web, which the FastAPI app serves.
// That keeps deployment Python-only: Render, Docker and Procfile need no Node step,
// because the compiled assets are committed alongside the source that produced them.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../web",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
