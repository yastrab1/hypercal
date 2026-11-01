import { createHash } from "node:crypto";
export function androidUpdateMetadata(apk, gradle) {
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !versionName)
    throw new Error("Invalid Android build version");
  return {
    packageId: "app.hypercal.calendar",
    versionCode,
    versionName,
    size: apk.length,
    sha256: createHash("sha256").update(apk).digest("hex"),
    download: "/download",
  };
}
