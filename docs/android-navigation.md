# Android Back navigation

The application already registers one Capacitor `backButton` listener. A delivered
Back event clears panels, event/day previews, shared routes, and the drawer, then
selects the default month view when returning from another screen or layout.
On an unobstructed month view, Back exits the app.

The Android activity previously hid both system bars with transient immersive
behavior, and reapplied it whenever the window regained focus. Android can use
an initial edge swipe to reveal hidden system navigation before delivering Back.
See [Android's immersive-mode guidance](https://developer.android.com/develop/ui/views/layout/immersive).

The activity now shows navigation, hides only the status bar, and uses default
system-bar behavior. Capacitor's startup configuration also keeps navigation
visible. Native insets reserve the navigation area, including side navigation
in landscape; keyboard and navigation bottom insets use their maximum rather
than being added together.

## Validation, 2026-11-03

- Production TypeScript/Vite build and Capacitor Android sync passed.
- Android `assembleDebug testDebugUnitTest` passed.
- All 104 Node tests passed with `node --test --test-concurrency=1 tests/*.test.mjs`.
  An initial concurrent run had one API-server startup timeout under heavy load.
- Installed the resulting APK on the Android 16 emulator. A single injected
  Android `KEYCODE_BACK` returned week directly to month. Window inspection
  reported default system-bar behavior with navigation visible.
- Edge-swipe verification was inconclusive because the emulator's System UI
  became unresponsive. The injected Back check verifies app routing, not the
  physical gesture path. Physical-device gesture and frame-rate checks remain.

## Device regression checks

With gesture navigation enabled, open week/day/year, event details, settings,
and a shared view in turn. Swipe inward once from either side: the app should
return to the default month view. Repeat after backgrounding/resuming the app.
Check that editor actions remain above navigation and the keyboard. Repeat with
three-button navigation and in landscape to check the reserved insets.
