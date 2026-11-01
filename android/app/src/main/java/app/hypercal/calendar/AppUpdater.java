package app.hypercal.calendar;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Native, fixed-origin self-updater. Never accepts a download URL from web content. */
final class AppUpdater {
    private static final String ORIGIN = "https://r2d2.tail6caf54.ts.net:10000";
    private static final int MAX_APK = 32 * 1024 * 1024;
    private final MainActivity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean active, running, waitingForPermission;
    private long lastCheck;
    private File pending;

    AppUpdater(MainActivity activity) { this.activity = activity; }

    void resume() {
        active = true;
        if (waitingForPermission) {
            waitingForPermission = false;
            if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) install();
            else Toast.makeText(activity, "Update saved. Allow HyperCal to install updates when you are ready.", Toast.LENGTH_LONG).show();
            return;
        }
        if (running || System.currentTimeMillis() - lastCheck < 15 * 60_000) return;
        running = true;
        lastCheck = System.currentTimeMillis();
        executor.execute(() -> {
            try { check(); }
            catch (Exception ignored) { /* Offline or invalid update: keep the installed app usable. */ }
            finally { activity.runOnUiThread(() -> running = false); }
        });
    }

    void pause() { active = false; }
    void close() { active = false; executor.shutdownNow(); }

    private HttpURLConnection connection(String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(10_000);
        c.setReadTimeout(20_000);
        c.setRequestProperty("Cache-Control", "no-cache");
        if (c.getResponseCode() != 200) { c.disconnect(); throw new IOException("Update unavailable"); }
        return c;
    }

    private void check() throws Exception {
        JSONObject metadata;
        HttpURLConnection c = connection("/downloads/android-update.json");
        try (InputStream input = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int n;
            while ((n = input.read(buffer)) != -1) {
                if (out.size() + n > 16384) throw new IOException("Metadata too large");
                out.write(buffer, 0, n);
            }
            metadata = new JSONObject(out.toString("UTF-8"));
        } finally { c.disconnect(); }
        PackageManager pm = activity.getPackageManager();
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        long code = metadata.getLong("versionCode");
        long size = metadata.getLong("size");
        String hash = metadata.getString("sha256");
        if (code <= version(installed) || size <= 0 || size > MAX_APK || !hash.matches("[a-f0-9]{64}")) return;
        if (!activity.getPackageName().equals(metadata.getString("packageId"))) return;
        String versionName = metadata.getString("versionName");
        if (versionName.length() > 60) return;
        android.content.SharedPreferences prefs = activity.getSharedPreferences("updates", 0);
        if (prefs.getLong("deferredVersion", 0) == code && System.currentTimeMillis() - prefs.getLong("deferredAt", 0) < 24 * 3600_000L) return;
        File dir = new File(activity.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) return;
        File apk = new File(dir, "hypercal-" + code + ".apk");
        if (!apk.isFile() || apk.length() != size || !digest(apk).equals(hash)) {
            File temp = new File(dir, "download.tmp");
            c = connection("/download");
            try (InputStream input = c.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[32768]; long total = 0; int n;
                while ((n = input.read(buffer)) != -1) {
                    total += n;
                    if (Thread.currentThread().isInterrupted() || total > size) throw new IOException("Invalid download");
                    out.write(buffer, 0, n);
                }
                if (total != size) throw new IOException("Incomplete download");
                out.getFD().sync();
            } finally { c.disconnect(); }
            if (!digest(temp).equals(hash)) { temp.delete(); return; }
            if (!temp.renameTo(apk)) { temp.delete(); return; }
        }
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        if (archive == null || !installed.packageName.equals(archive.packageName) || version(archive) != code ||
            !signers(installed).equals(signers(archive)) || signers(installed).isEmpty()) { apk.delete(); return; }
        for (File old : Objects.requireNonNull(dir.listFiles())) if (!old.equals(apk)) old.delete();
        activity.runOnUiThread(() -> {
            if (!active || activity.isFinishing() || activity.isDestroyed()) return;
            pending = apk;
            new AlertDialog.Builder(activity)
                .setTitle("HyperCal update ready")
                .setMessage("Version " + versionName + " has downloaded. Install it now?")
                .setPositiveButton("Install", (dialog, which) -> install())
                .setNegativeButton("Later", (dialog, which) -> defer(code))
                .setOnCancelListener(dialog -> defer(code))
                .show();
        });
    }

    private void defer(long code) {
        activity.getSharedPreferences("updates", 0).edit().putLong("deferredVersion", code)
            .putLong("deferredAt", System.currentTimeMillis()).apply();
    }

    private void install() {
        if (pending == null || !pending.isFile()) return;
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                waitingForPermission = true;
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                return;
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", pending);
            activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (Exception ignored) {
            waitingForPermission = false;
            Toast.makeText(activity, "Could not open the installer. Download the update from HyperCal’s website.", Toast.LENGTH_LONG).show();
        }
    }

    private static long version(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }
    private static Set<String> signers(PackageInfo info) throws Exception {
        Set<String> result = new HashSet<>();
        if (info.signatures != null) for (Signature signature : info.signatures)
            result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }
    private static String digest(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768]; int n;
            while ((n = input.read(buffer)) != -1) md.update(buffer, 0, n);
        }
        return hex(md.digest());
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
}
