# HyperCal

[![Build and test](https://github.com/yastrab1/hypercal/actions/workflows/build.yml/badge.svg)](https://github.com/yastrab1/hypercal/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A keyboard-friendly web and Android interface for Google Calendar, with saved filters and a different default view for each layout.

Google Calendar remains the source of truth. HyperCal writes event changes directly to Google and reads changes made elsewhere. Use a detailed school timetable for your day and a quieter calendar for your month, without moving or duplicating events.

**[Download the latest Android APK](https://github.com/yastrab1/hypercal/releases/download/continuous/hypercal-debug.apk)** · [Releases](https://github.com/yastrab1/hypercal/releases) · [Builds](https://github.com/yastrab1/hypercal/actions)

## Features

- Day, week, month and year layouts, connected multi-day event bars, and expandable event lists for busy days.
- Event detail popups with inline deletion confirmation and copying to another writable calendar, with a separate editor for changes. Copies leave the source unchanged and copy only the selected occurrence, without inviting guests. Create, edit and delete events, set locations, descriptions, notifications, custom event colors and repeating events. The default swatches match the supplied Google Calendar palette. Notifications support a custom amount in minutes, hours or days, with an account default in Settings for new events. Custom colors keep their exact hex value in private Google event metadata; Google Calendar uses the nearest supported event color.
- Saved views that filter calendars and event text. Built-in and custom views share one sidebar list. Replace each layout’s default with your own filtered view on the web; those choices also apply on Android. Clicking a date opens the default day view.
- Light, dark and system themes. Compact mobile calendar, animated swipe navigation, a week grid that fits the screen width, and a swipeable drawer containing your account and views. Android uses an immersive window with no sync footer.
- Command palette and keyboard shortcuts. Arrow keys move by the displayed period; shortcuts pause while typing.
- Public iCalendar URL subscriptions, `webcal://` links and `.ics` snapshot imports, with recurrence support. Imported/subscribed calendars are read-only within HyperCal.
- Read-only offline caching of recently visited ranges. Sync runs on launch, resume, reconnect and every minute while visible; a small top indicator reports progress. Offline changes are not queued.
- Shared views with Google sign-in invitations, per-member calendar contributions and revocable export links.
- Android Back returns popups and other layouts to Month, then closes the app. Desktop navigation can be collapsed.
- Android sign-in through the system browser. OAuth credentials stay on the backend.

HyperCal is an early prototype. It does not yet include attendee management, drag-to-reschedule, series editing or offline edit queues. Shared views support email-bound invitations, contributions from each member’s Google calendars, detail policies and revocable read-only web/iCalendar links. See [sharing behavior and limits](docs/SHARED_VIEWS.md).

### Tags and date details

Create colored tags below the collapsible calendar list, or add them while editing an event. Click a tag name to track it for the current view: only that tag shows an eye icon. Each saved view and each built-in layout remembers its own selection. Its bright top-bar pill shows days (`12d`) or calendar months plus days (`2mo 3d`) until the nearest event; `—` means no upcoming event was found. The countdown checks calendars independently of the displayed period. Google lookups have no future cutoff; subscribed/imported feeds are expanded up to five years ahead. Tagged events are saved on disk in `.data/tagged-events/` with private per-account files. Successful writes update this cache immediately; stale Google list/search responses do not erase just-saved tags. Countdowns return saved values immediately, then refresh Google in the background. The cache survives app/container restarts. Failed lookups retain cached countdowns and expose the refresh status in the pill tooltip.

Tags are stored in Google event extended properties and in HyperCal iCalendar exports as standard `CATEGORIES`; imported `CATEGORIES` are read back. Google's own export does not guarantee conversion of application properties into categories. Calendar creation uses the Google `calendar.calendars` permission. Existing users can reconnect from account settings to grant it; no subscription URL is required to create an empty Google calendar.

Click a date number in day, week or month view for its distance from today and its events. Clicking elsewhere in a month cell still opens the default day view. Keyboard shortcuts and Ctrl/Cmd K remain available after removing the Commands button.

## Android download

The release APK is a **debug build**, signed consistently across maintainer builds. It can update earlier debug installs signed with that identity. Installation and native behavior have not been tested on every Android device.

Maintainer builds may point at a private backend and require access to its network. Publishing the APK does not make that backend public. To run your own instance, deploy the server and build with your own `HYPERCAL_ANDROID_URL`. Without that variable, Android bundles the web interface for demo use; connecting a real account requires the configured HTTPS backend build.

A first online launch is required before the application shell and calendar ranges can be used offline. Only visited ranges are cached, up to six ranges for 14 days, separately by account. Sign-out clears private device caches.

## Run locally

Requires Node.js 22.13 or later (for built-in SQLite).

```sh
git clone https://github.com/yastrab1/hypercal.git
cd hypercal
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. Demo events work without a Google Cloud project. Vite proxies `/api` and `/auth` to the Node backend on port 3001.

```sh
npm test
npm run build
```

## Docker and Compose

The multi-stage Docker image builds the web interface and installs production dependencies. Its build context excludes secrets, runtime data and Android signing keys. Node runs without root privileges; Compose keeps `/data` writable while the image filesystem is read-only.

```sh
cp .env.example .env
# Set APP_URL=http://localhost:3791 for a local Docker demo.
# For public HTTPS, set APP_URL to the public URL and COOKIE_SECURE=true.
mkdir -p dist/downloads
docker compose up -d --build
```

The standalone Compose file publishes only `127.0.0.1:3791` and persists accounts, sessions and shared views in the `hypercal-data` volume. Keep Google credentials in the private `.env`; they are passed at runtime. If using `GOOGLE_CREDENTIALS_FILE` instead, mount that JSON file read-only through a local Compose override and set its container path.

For public access through an existing Tailscale host, enable a narrowly scoped Funnel policy and forward an unused supported port, for example:

```sh
tailscale funnel --bg --https=10000 http://127.0.0.1:3791
```

Set `APP_URL` to the resulting HTTPS URL, register its `/auth/google/callback` with Google, and build Android using the same URL. Funnel exposes the application; Google sign-in and sharing permissions still apply. The [unified-stack Compose file and deployment notes](deploy/unified/README.md) document the R2D2 deployment and preserve its existing data and private services.

## Connect Google Calendar

1. Create or select a Google Cloud project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen. If the app is in testing, add the intended Google accounts as test users.
3. Create a **Web application** OAuth client.
4. Add an authorized redirect URI matching your `APP_URL` exactly, followed by `/auth/google/callback`. For local development:

   ```text
   http://localhost:5173/auth/google/callback
   ```

5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the private server `.env`, then restart the server. Alternatively, set `GOOGLE_CREDENTIALS_FILE` to the path of your downloaded client JSON outside the repository.
6. Use **Connect Google** in HyperCal and review Google's consent screen.

Scopes: `openid`, `email`, `calendar.events`, `calendar.calendars`, and `calendar.calendarlist.readonly`. Test-mode grants may expire according to Google's policies. Tokens and server sessions are stored under the ignored `.data/` directory with private filesystem permissions. Back that directory up securely. Never commit `.env`, credential files, tokens or cached personal calendar data.

## Self-host

Build the frontend and run the server from the project directory:

```sh
npm ci
npm run build
NODE_ENV=production npm start
```

Production serves the API and `dist/` together. Put it behind an HTTPS reverse proxy and set:

```dotenv
HOST=127.0.0.1
PORT=3001
APP_URL=https://calendar.example.com
TRUST_PROXY=1
COOKIE_SECURE=true
SESSION_SECRET=your-long-random-secret
DATA_DIR=.data
```

Register `https://calendar.example.com/auth/google/callback` with your OAuth client. Tailscale Serve is also suitable for a private installation. A systemd user service template is in [deploy/hypercal.service](deploy/hypercal.service); adjust the installation path as needed.

The current file store supports one Node process. Use a database before deploying multiple instances or shared views. Google changes are read on refresh rather than pushed; iCal URL feeds refresh on a five-minute cache. Feed URLs must be public HTTP(S) endpoints; arbitrary private-network fetches and custom authentication headers are not supported.

## Build Android

Requires Java 21 and Android SDK platform 36, with `ANDROID_HOME` configured.

```sh
HYPERCAL_ANDROID_URL=https://calendar.example.com npm run android:build
```

Outputs:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `artifacts/HyperCal-debug.apk`
- `dist/downloads/hypercal-debug.apk` and its SHA-256 checksum

With an emulator or test device connected, run the native fullscreen regression test (launch, resume, native window bounds and CSS viewport bounds):

```sh
npm run android:sync
cd android
./gradlew :app:connectedDebugAndroidTest
```

The backend also serves the packaged APK at `/downloads/hypercal-debug.apk`. Build packaging runs after Capacitor sync so the APK is not recursively bundled into itself.

## CI and releases

Every push to `main` and every pull request runs tests, builds and smoke-tests the Docker image, builds the web app and builds an Android debug APK. Successful pushes to `main` update the **continuous** prerelease and its stable APK download URL. Version tags matching `v*` create versioned releases. Build artifacts are also available from the Actions run.

Repository configuration:

- Optional Actions variable **`HYPERCAL_ANDROID_URL`**: HTTPS backend included in Android builds. This URL is embedded in the APK and is not a secret.
- Optional Actions secret **`ANDROID_DEBUG_KEYSTORE_BASE64`**: persistent Android debug keystore, base64 encoded, for update-compatible maintainer builds. The raw keystore must never be committed. Fork pull requests do not receive this secret and use a temporary debug identity.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl/Cmd K | Command palette |
| D / W / M / Y | Default day / week / month / year view |
| ← / →, K / J, P / N | Previous / next displayed period |
| T | Today |
| G | Go to a date |
| C | Create event |
| 1–9 | Saved views |
| / | Search visible events |
| Ctrl/Cmd Enter | Save editor |
| Escape | Close popup, drawer or editor |
| ? | Shortcut reference |

Single-key shortcuts can be disabled in settings. Within form fields and focused calendar grids, local editing/navigation keys take priority.

## Project structure

- `src/`: React UI, calendar layout, filtering, gestures and device cache.
- `server/`: Express API, Google OAuth adapter, private view storage and iCalendar parsing.
- `android/`: Capacitor Android project.
- `scripts/`: offline shell generation and APK packaging.
- `tests/`: calendar boundaries, filter semantics, account isolation, cache behavior and simulated Google API integration.

## License

[MIT](LICENSE). Google Calendar is a Google product; HyperCal is an independent interface and is not affiliated with or endorsed by Google.
