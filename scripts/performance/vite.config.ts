import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
const baseline = process.env.HYPERCAL_BENCH_BASELINE === "1";
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: baseline
      ? [
          {
            find: "../../src/Calendar",
            replacement: resolve(
              "artifacts/performance/baseline-source/src/Calendar.tsx",
            ),
          },
          {
            find: "../../src/style.css",
            replacement: resolve(
              "artifacts/performance/baseline-source/src/style.css",
            ),
          },
        ]
      : [],
  },
  build: {
    outDir: `artifacts/performance/${baseline ? "baseline" : "current"}`,
    emptyOutDir: true,
    rollupOptions: { input: resolve("scripts/performance/index.html") },
  },
});
