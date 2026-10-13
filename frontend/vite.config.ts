import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// The built site is written straight into backend/static so the FastAPI app
// can serve it without any extra copy step.
export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../backend/static", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: root + "index.html",
        privacy: root + "privacy.html",
        dashboard: root + "dashboard.html",
        install: root + "install.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
