# Android auto-update verification, 2026-11-03

R2D2's `/download` and `/downloads/android-update.json` served the correct
v0.10.7/version code 26 payload, byte size, SHA-256, package and maintainer signing
identity. Both routes send `Cache-Control: no-store`; the native updater also
uses a fixed HTTPS origin, disables connection caches and requests revalidation.

The released v0.10.6 APK (code 25) was installed on the Android 16 emulator. On
launch its existing updater fetched the live R2D2 APK, verified it and displayed
“Version 0.10.7 has downloaded. Install it now?” This establishes compatibility
of that previously released version; it does not establish the version or exact
state of the user's phone.

The earlier updater had three concrete lifecycle gaps:

- It set its 15-minute throttle before the request, so network failure also
  suppressed another resume check for 15 minutes.
- It scheduled no timer while open. A release published after the initial check
  was not detected until another qualifying resume or process restart.
- A completed download was discarded from the UI state when the activity was
  paused. Returning before the throttle expired did not restore its prompt.

Version 0.10.8 checks on resume, polls every 15 minutes while foregrounded, retries
failures after 30 seconds, and retains a verified pending APK for the next resume.
It exposes native status and a manual check through a fixed native plugin; web
content cannot supply an update origin or an APK URL. Package, version, byte
size, hash and signer verification remain mandatory.

Settings displays the installed native version/build and the web version
separately. Earlier APKs can read their installed version through the existing
Capacitor App plugin, even before the native updater changes are installed.
The new Check for updates button bypasses the interval and a previous Later
choice. Failures appear in Settings and Android logs under `HypercalUpdater`.

Regression checks include `UpdateScheduleTest` for periodic checks, offline
retry, resume and manual checks without concurrent downloads; and the Android
`UpdateLifecycleTest` for a download completing while paused and showing its
prompt when resumed. The lifecycle test uses a synthetic already-validated file
and never launches its installer. Published-payload verification separately uses
the actual released APK through R2D2.
