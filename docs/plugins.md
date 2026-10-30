# HyperCal plugins

Plugins run on the server, with settings managed from **Calendar settings → Manage plugins**, also accessible from **Plugins** in the phone or web sidebar. The first installed plugin is EduPage. View creation, editing, filters, scrolling options and layout defaults are available in **Calendar settings → View settings** on both platforms.

## Automatic triggers

The default is **When HyperCal opens or resumes**. The verified Google session queues a background job, cached calendar content stays usable, and the client refreshes the visible event ranges when the import finishes. A one-minute freshness window deduplicates focus changes and opens across devices. There is no repeating background schedule in this mode.

You can opt into an interval in minutes or hours (minimum five minutes), including while the app is closed. Authenticated webhooks are optional. Generate a token from the plugin's settings and send an HTTP POST to the displayed URL with an `Authorization: Bearer …` header. Tokens are shown only when generated, stored as hashes, and can be replaced or disabled. Do not put tokens in query strings.

Jobs are persisted before execution, run serially, and never overlap for the same plugin. An interrupted job is marked on server restart and retried by its next trigger. Errors and the last twenty run results are visible in settings. Removing a plugin is reversible with Undo and keeps imported calendar events.

## EduPage setup

1. Create or choose a writable Google calendar, preferably a separate EduPage calendar.
2. Add the EduPage plugin, enter the school website and select that calendar.
3. Configure credentials on the server, or use the isolated browser connection screen for direct sign-in and verification.
4. Select exams/homework, optional excluded subjects (select detected subjects or enter exact names, one per line), and an optional exclusion regex.
5. Enable automatic sync and save. Future app opens trigger imports automatically.

Credentials live only in a private server file, `.env.edupage` in the HyperCal checkout:

```dotenv
EDUPAGE_SCHOOL_URL=https://smnd.edupage.org
EDUPAGE_OWNER_EMAIL=your-google-account@example.com
EDUPAGE_USERNAME=
EDUPAGE_PASSWORD=
```

Use permissions `0600`. Single-quote values containing `$` so Compose does not interpolate them. Recreate both `hypercal` and `hypercal-browser` after changes. The owner email must match the Google account that configures the plugin. Other HyperCal users cannot use these credentials. Credentials are never returned by the API, shipped in the APK, or committed. `worker/.env.example` is a safe template.

The browser worker reuses a private session and can sign in again using the environment credentials. It continues past EduPage's remember-sign-in prompt without storing the password in Chromium. QR/extra verification can be completed in the connection screen. A screenshot and keyboard controls are proxied only through the owning user's authenticated HyperCal session; no browser port is published.

Imports currently cover upcoming homework and announced exam/test items exposed by EduPage's dashboard/timeline. They are all-day events on the source due/exam date. Unsupported or invalid dates are skipped, never invented. Source IDs generate stable Google event IDs, so interrupted inserts can recover without creating duplicates. Only changed assignments produce writes. Personal events and other plugins' events are not modified. Missing or newly excluded source items do **not** delete existing imports. Changing the destination imports into the new calendar and leaves prior imports in the old calendar.

Regex matching is case-insensitive and uses RE2 to avoid expensive backtracking. Lookarounds and backreferences are unsupported. Regexes match the subject, title and description. Subject names can be copied from the connection's detected-subject list.

## Deployment

Both `compose.yaml` and `deploy/unified/docker-compose.hypercal.yml` define the browser sidecar. The unified stack uses:

- A non-root browser container on the private HyperCal network, with no published ports.
- Chromium's sandbox, the pinned Playwright image and its supplied seccomp profile. Only the browser's required `SYS_CHROOT` capability is added; other capabilities are dropped.
- Read-only container filesystems and bounded temporary/shared memory.
- Private persistent browser sessions and a private shared worker-token file under the existing data directory.
- Navigation restricted to HTTPS EduPage domains, with service workers and downloads disabled.

For the unified stack, copy `deploy/browser-seccomp.json` beside the Compose file. Create `.data/plugin-browser` owned by the app UID, mode `0700`, and `.data/browser-worker-token` containing a random secret, mode `0600`; HyperCal also generates the token automatically on startup. Start/recreate only the two HyperCal services. In standalone Compose, start the app first to initialize the shared data volume/token before starting the browser worker.

## Extending the system

This prototype runs **operator-installed, trusted Node modules**, not arbitrary uploaded scripts. It is not a sandbox for hostile third-party JavaScript. Add a manifest to the catalog and a runner to the registry in `server/plugins.mjs`, with a validated configuration schema and appropriate UI fields.

Runners receive an instance and a scoped API context from `server/plugin-api.mjs`, without receiving OAuth tokens. The context fixes the account and selected calendar and checks the manifest's capabilities:

- `events.list(from, to)` lists plugin-owned events.
- `events.create(sourceId, body)` uses a stable source ID; `events.update` and `events.remove` verify ownership and use provider etags.
- `calendars.getTarget`, `calendars.updateTarget`, and `calendars.create` require separate manifest permissions. EduPage has read-only calendar metadata access and cannot rename/create calendars.
- The EduPage runner additionally uses an assignment reconciliation helper that preserves unchanged results and writes only changed items.

Event API fields are limited to event content/time/reminders/color; invitation recipients are not accepted. As with all trusted server modules, operators must review plugin code before deployment.

## Protocol and runtime references

The EduPage adapter is independently implemented. Dashboard/timeline field names were checked against the public [EdupageAPI assignment implementation](https://github.com/loumadev/EdupageAPI/blob/master/src/Assignment.js) and [dashboard implementation](https://github.com/loumadev/EdupageAPI/blob/master/src/Edupage.js). These are unofficial EduPage internals and may change; live account verification remains necessary after provider changes. No code from that library is bundled.

The sidecar follows the primary [Playwright Docker guidance](https://playwright.dev/docs/docker). `deploy/browser-seccomp.json` is the upstream Playwright Docker profile pinned to the same release as the browser image.
