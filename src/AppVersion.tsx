import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { version as webVersion } from "../package.json";

type UpdateStatus = { message: string; checking: boolean };
const Updates = registerPlugin<{
  getStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
}>("Updates");

export function AppVersion() {
  const native = Capacitor.isNativePlatform();
  const supported = native && Capacitor.isPluginAvailable("Updates");
  const [installed, setInstalled] = useState("");
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let disposed = false;
    if (native) NativeApp.getInfo().then(info => {
      if (!disposed) setInstalled(`${info.version} (${info.build})`);
    }).catch(() => { if (!disposed) setInstalled("Version unavailable"); });
    const refresh = () => {
      if (supported) Updates.getStatus().then(value => {
        if (!disposed) setStatus(value);
      }).catch(() => {});
    };
    refresh();
    const timer = supported ? setInterval(refresh, 1500) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [native, supported]);
  return <footer className="app-version-settings">
    <div className="settings-divider" />
    <p className="muted">HyperCal {native ? installed || "Reading installed version…" : webVersion}</p>
    {native && <small className="muted">Web app {webVersion}</small>}
    {supported ? <>
      <button type="button" className="secondary-button" disabled={status?.checking}
        onClick={async () => {
          setStatus({ message: "Checking for updates…", checking: true });
          try { setStatus(await Updates.checkForUpdates()); }
          catch { setStatus({ message: "Could not check for updates. Try again.", checking: false }); }
        }}>
        {status?.checking ? "Checking…" : "Check for updates"}
      </button>
      <p className="small muted" role="status">{status?.message}</p>
    </> : native && <p className="small muted">Updates are checked when HyperCal opens. Fully close the app, then reopen it to check again.</p>}
  </footer>;
}
