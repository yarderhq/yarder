import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, "src/gui"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(rootDir, "src/gui"),
    },
  },
  build: {
    outDir: path.join(rootDir, "dist/gui"),
    emptyOutDir: true,
  },
});
