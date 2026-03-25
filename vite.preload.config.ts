import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@application": path.resolve(__dirname, "app/src/application"),
      "@domain": path.resolve(__dirname, "app/src/domain"),
      "@providers": path.resolve(__dirname, "app/src/providers"),
      "@renderer": path.resolve(__dirname, "app/src"),
      "@styles": path.resolve(__dirname, "app/src/styles"),
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "app/electron/preload/index.ts"),
      formats: ["cjs"],
    },
    outDir: path.resolve(__dirname, "dist-electron/electron/preload"),
    rollupOptions: {
      external: ["electron"],
      output: {
        entryFileNames: "index.cjs",
      },
    },
    sourcemap: true,
    target: "node20",
  },
});
