import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const from = "android/app/build/outputs/apk/debug/app-debug.apk";
mkdirSync("artifacts", { recursive: true });
mkdirSync("dist/downloads", { recursive: true });
copyFileSync(from, "artifacts/HyperCal-debug.apk");
copyFileSync(from, "dist/downloads/hypercal-debug.apk");
const hash = createHash("sha256").update(readFileSync(from)).digest("hex");
writeFileSync(
  "dist/downloads/hypercal-debug.apk.sha256",
  hash + "  hypercal-debug.apk\n",
);
console.log("Packaged APK at /downloads/hypercal-debug.apk; SHA-256 " + hash);
