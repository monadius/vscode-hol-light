// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // This controls the naming of the output files
        entryFileNames: "index.js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name].[ext]"
      }
    }
  }
});