package app.hypercal.calendar;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
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
    private final UpdateSchedule schedule = new UpdateSchedule();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = () -> startCheck(false);
    private boolean waitingForPermission;
    private boolean closed;
    private AlertDialog prompt;
    private String status = "Not checked yet.";
    private long pendingCode;
    private String pendingName;
    private File pending;

    AppUpdater(MainActivity activity) { this.activity = activity; }

    void resume() {
        schedule.resume();
        if (waitingForPermission) {
            waitingForPermission = false;
            if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) {
                install();
                return;
            }
            Toast.makeText(activity, "Update saved. Allow HyperCal to install updates when you are ready.", Toast.LENGTH_LONG).show();
            defer(pendingCode);
        }
        showPending();
        startCheck(false);
    }

    String status() { return status; }
    boolean checking() { return schedule.running; }

    void checkNow() {
        activity.getSharedPreferences("updates", 0).edit()
            .remove("deferredVersion").remove("deferredAt").apply();
        showPending();
        startCheck(true);
    }

    private void startCheck(boolean manual) {
        if (closed || !schedule.begin(SystemClock.elapsedRealtime(), manual)) return;
        handler.removeCallbacks(poll);
        status = "Checking for updates…";
        executor.execute(() -> {
            boolean success = false;
            String result;
            try { result = check(); success = true; }
            catch (Exception error) {
                Log.w("HypercalUpdater", "Update check failed", error);
                result = "Could not check for updates. Retrying shortly.";
            }
            final String message = result;
            final boolean checked = success;
            handler.post(() -> {
                if (closed) return;
                status = message;
                schedule.finish(SystemClock.elapsedRealtime(), checked);
                showPending();
                if (schedule.active) handler.postDelayed(poll, schedule.delay(SystemClock.elapsedRealtime()));
            });
        });
    }

    void pause() { schedule.pause(); handler.removeCallbacks(poll); }
    void close() { closed = true; pause(); handler.removeCallbacksAndMessages(null); executor.shutdownNow(); }

    private HttpURLConnection connection(String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(10_000);
        c.setReadTimeout(20_000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        if (c.getResponseCode() != 200) { c.disconnect(); throw new IOException("Update unavailable"); }
        return c;
    }

    private String check() throws Exception {
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
        if (code <= version(installed)) return "HyperCal is up to date.";
        if (size <= 0 || size > MAX_APK || !hash.matches("[a-f0-9]{64}")) throw new IOException("Invalid update metadata");
        if (!activity.getPackageName().equals(metadata.getString("packageId"))) throw new IOException("Update package mismatch");
        String versionName = metadata.getString("versionName");
        if (versionName.length() > 60) throw new IOException("Invalid update version");
        if (deferred(code)) return "Version " + versionName + " postponed. Check for updates to install now.";
        File dir = new File(activity.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create update directory");
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
            if (!digest(temp).equals(hash)) { temp.delete(); throw new IOException("Update checksum mismatch"); }
            if (!temp.renameTo(apk)) { temp.delete(); throw new IOException("Cannot save update"); }
        }
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        if (archive == null || !installed.packageName.equals(archive.packageName) || version(archive) != code ||
            !signers(installed).equals(signers(archive)) || signers(installed).isEmpty()) { apk.delete(); throw new IOException("Update signing identity or version mismatch"); }
        for (File old : Objects.requireNonNull(dir.listFiles())) if (!old.equals(apk)) old.delete();
        activity.runOnUiThread(() -> downloaded(apk, code, versionName));
        return "Version " + versionName + " is ready to install.";
    }

    // Called on the UI thread only after download/package/signature validation.
    void downloaded(File apk, long code, String name) {
        if (closed) return;
        pending = apk;
        pendingCode = code;
        pendingName = name;
        showPending();
    }

    private boolean deferred(long code) {
        android.content.SharedPreferences prefs = activity.getSharedPreferences("updates", 0);
        return prefs.getLong("deferredVersion", 0) == code && System.currentTimeMillis() - prefs.getLong("deferredAt", 0) < 24 * 3600_000L;
    }

    private void showPending() {
        if (pending == null || !pending.isFile() || !schedule.active || closed ||
            activity.isFinishing() || activity.isDestroyed() || prompt != null || deferred(pendingCode)) return;
        prompt = new AlertDialog.Builder(activity)
                .setTitle("HyperCal update ready")
                .setMessage("Version " + pendingName + " has downloaded. Install it now?")
                .setPositiveButton("Install", (dialog, which) -> install())
                .setNegativeButton("Later", (dialog, which) -> defer(pendingCode))
                .setOnCancelListener(dialog -> defer(pendingCode))
                .create();
        prompt.setOnDismissListener(dialog -> prompt = null);
        prompt.show();
    }

    private void defer(long code) {
        status = "Version " + pendingName + " postponed. Check for updates to install now.";
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
