package app.hypercal.calendar;

import static org.junit.Assert.*;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Regression: system-bar compatibility padding must not shrink the WebView. */
@RunWith(AndroidJUnit4.class)
public class FullscreenTest {
    @Test public void calendarFillsWindowAfterLaunchAndResume() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertFullWindow(scenario);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            assertFullWindow(scenario);
        }
    }
    private void assertFullWindow(ActivityScenario<MainActivity> scenario) throws Exception {
        // Wait for the first native layout and system-bar hide transaction.
        long deadline = System.currentTimeMillis() + 10000;
        boolean[] ready = {false};
        while (!ready[0] && System.currentTimeMillis() < deadline) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
                ready[0] = decor.getHeight() > 0 && activity.getBridge().getWebView().getHeight() > 0
                    && insets != null && !insets.isVisible(WindowInsetsCompat.Type.statusBars())
                    && !insets.isVisible(WindowInsetsCompat.Type.navigationBars());
            });
            if (!ready[0]) Thread.sleep(100);
        }
        assertTrue("Immersive window did not settle", ready[0]);
        scenario.onActivity(activity -> {
            View decor = activity.getWindow().getDecorView();
            View web = activity.getBridge().getWebView();
            assertEquals("No top compatibility band", 0, decor.getPaddingTop());
            assertEquals("No bottom compatibility band", 0, decor.getPaddingBottom());
            if (android.os.Build.VERSION.SDK_INT >= 30)
                assertEquals("Decor fills the physical app window", activity.getWindowManager().getCurrentWindowMetrics().getBounds().height(), decor.getHeight());
            assertEquals("WebView fills the window height", decor.getHeight(), web.getHeight());
            assertEquals("WebView fills the window width", decor.getWidth(), web.getWidth());
        });
        long domDeadline = System.currentTimeMillis() + 20000;
        java.util.concurrent.atomic.AtomicReference<String> result = new java.util.concurrent.atomic.AtomicReference<>();
        do {
            java.util.concurrent.CountDownLatch callback = new java.util.concurrent.CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "(()=>{const app=document.querySelector('.app-shell');const canvas=document.querySelector('.calendar-surface');return !!app&&!!canvas&&Math.abs(app.getBoundingClientRect().height-innerHeight)<2&&Math.abs(canvas.getBoundingClientRect().bottom-innerHeight)<2&&document.documentElement.scrollWidth===innerWidth})()",
                value -> {result.set(value); callback.countDown();}));
            callback.await(3, java.util.concurrent.TimeUnit.SECONDS);
            if ("true".equals(result.get())) break;
            Thread.sleep(100);
        } while (System.currentTimeMillis() < domDeadline);
        assertEquals("Calendar CSS reaches the viewport bottom without overflow", "true", result.get());
    }
}
