package app.hypercal.calendar;

import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Own insets here. Capacitor's compatibility handler pads the whole
        // decor view on older WebViews, leaving grey bands even in immersive mode.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            int keyboard = insets.isVisible(WindowInsetsCompat.Type.ime())
                ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
            view.setPadding(0, 0, 0, keyboard);
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
                .build();
        });
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        getWindow().getDecorView().setBackgroundColor(Color.TRANSPARENT);
        useFullScreen();
        ViewCompat.requestApplyInsets(getWindow().getDecorView());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) useFullScreen();
    }

    private void useFullScreen() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
