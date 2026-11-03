package app.hypercal.calendar;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Updates")
public class UpdatesPlugin extends Plugin {
    @PluginMethod public void getStatus(PluginCall call) { dispatch(call, false); }
    @PluginMethod public void checkForUpdates(PluginCall call) { dispatch(call, true); }
    private void dispatch(PluginCall call, boolean check) {
        getActivity().runOnUiThread(() -> {
            AppUpdater updater = ((MainActivity)getActivity()).updater();
            if (updater == null) { call.reject("Updater is starting. Try again shortly."); return; }
            if (check) updater.checkNow();
            JSObject result = new JSObject();
            result.put("message", updater.status());
            result.put("checking", updater.checking());
            call.resolve(result);
        });
    }
}
