import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { androidUpdateMetadata } from "../server/android-update.mjs";

test("Android update metadata binds the published version to exact APK bytes", () => {
  const apk = Buffer.from("signed apk fixture");
  const meta = androidUpdateMetadata(
    apk,
    'versionCode 22\n versionName "0.10.3"',
  );
  assert.deepEqual(meta, {
    packageId: "app.hypercal.calendar",
    versionCode: 22,
    versionName: "0.10.3",
    size: apk.length,
    download: "/download",
    sha256: createHash("sha256").update(apk).digest("hex"),
  });
  assert.notEqual(
    meta.sha256,
    androidUpdateMetadata(
      Buffer.from("different apk"),
      'versionCode 22\nversionName "0.10.3"',
    ).sha256,
  );
  assert.throws(
    () => androidUpdateMetadata(apk, "versionCode 0"),
    /Invalid Android/,
  );
});
