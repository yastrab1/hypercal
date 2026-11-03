import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "app.hypercal.calendar",
  appName: "HyperCal",
  webDir: "dist",
  plugins: {
    SystemBars: {
      // MainActivity hides only the status bar. Hiding navigation here puts
      // Android in immersive mode and can consume the first system Back swipe.
      hidden: false,
      insetsHandling: "disable",
      initialViewportFitValueHint: "cover",
    },
  },
  server: process.env.HYPERCAL_ANDROID_URL
    ? {
        url: process.env.HYPERCAL_ANDROID_URL,
        cleartext: process.env.HYPERCAL_ANDROID_URL.startsWith("http:"),
      }
    : undefined,
};
export default config;
