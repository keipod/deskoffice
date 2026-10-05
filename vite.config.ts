import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 32180,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:32182"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
