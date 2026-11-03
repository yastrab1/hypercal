package app.hypercal.calendar;

import static org.junit.Assert.*;
import android.app.AlertDialog;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class UpdateLifecycleTest {
    @Test public void manualCheckCanUndoLaterForAnAlreadyDownloadedUpdate() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    File fixture = File.createTempFile("update-deferred", ".apk", activity.getCacheDir());
                    AppUpdater updater = activity.updater();
                    activity.getSharedPreferences("updates", 0).edit()
                        .putLong("deferredVersion", 999998).putLong("deferredAt", System.currentTimeMillis()).commit();
                    updater.downloaded(fixture, 999998, "deferred-test");
                    java.lang.reflect.Field prompt = AppUpdater.class.getDeclaredField("prompt");
                    prompt.setAccessible(true);
                    assertNull("Honor Later for automatic checks", prompt.get(updater));
                    updater.checkNow();
                    assertTrue("Manual check offers the pending file", ((AlertDialog)prompt.get(updater)).isShowing());
                } catch (Exception e) { throw new AssertionError(e); }
            });
        }
    }
    @Test public void downloadCompletingWhilePausedIsOfferedOnResume() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    File fixture = File.createTempFile("update-lifecycle", ".apk", activity.getCacheDir());
                    AppUpdater updater = activity.updater();
                    updater.pause();
                    updater.downloaded(fixture, 999999, "lifecycle-test");
                    java.lang.reflect.Field pending = AppUpdater.class.getDeclaredField("pending");
                    pending.setAccessible(true);
                    assertEquals("Keep the completed file while paused", fixture, pending.get(updater));
                    java.lang.reflect.Field prompt = AppUpdater.class.getDeclaredField("prompt");
                    prompt.setAccessible(true);
                    assertNull("Do not display over a backgrounded app", prompt.get(updater));
                    updater.resume();
                    assertTrue("Offer the file immediately on resume", ((AlertDialog)prompt.get(updater)).isShowing());
                } catch (Exception e) { throw new AssertionError(e); }
            });
        }
    }
}
