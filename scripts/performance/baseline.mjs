import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const folder = "artifacts/performance/baseline-source";
mkdirSync(folder, { recursive: true });
execFileSync("tar", ["-xf", "-", "-C", folder], {
  input: execFileSync("git", ["archive", "v0.8.1", "src"]),
});
execFileSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "scripts/performance/vite.config.ts",
  ],
  { env: { ...process.env, HYPERCAL_BENCH_BASELINE: "1" }, stdio: "inherit" },
);
