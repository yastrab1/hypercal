import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "app.hypercal.calendar",
  appName: "HyperCal",
  webDir: "dist",
  plugins: {
    SystemBars: {
      hidden: true,
      insetsHandling: "css",
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
