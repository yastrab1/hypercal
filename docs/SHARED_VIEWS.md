# Shared views

Shared views are available from the sidebar on the web and Android. They combine calendars without changing Google Calendar ACLs or copying source events. A shared view is read-only; edit source events in your own personal calendar.

## Create and invite

1. Open the private view whose layout and filters you want to share, then choose **Shared views → Share current view**.
2. Create the shared definition. No calendars are contributed automatically.
3. In settings, choose your Google calendars and a detail policy: busy only (initial choice), titles and times, or full event details including notes and location. Save contributions.
4. Enter a friend's Google account email and create an invitation link. Copy and send it yourself. Invitations expire after seven days, are restricted to that email, and can be used once. Owners can revoke pending invitations.
5. Friends sign in with their own Google account, accept, and choose their own contributions. Members can withdraw calendars or leave. The owner can remove members, edit the definition, or delete the view.

The prototype supports up to ten members and ten Google calendar contributions per member. iCalendar feed contributions and collaborative event editing are not included.

## Read-only links and iCalendar export

Public export is off for each contribution until its contributor explicitly opts in. Owners can create separate read-only web and iCalendar subscription links. Both expire after 30 days and can be revoked independently. Only opted-in contributions appear. Export includes busy times or titles and times, never notes, locations, Google event URLs, OAuth tokens, original provider IDs, or member email addresses.

Anyone possessing a link and able to access the server can read its permitted events. Private Tailscale hosting still requires access to that network. Calendar clients may retain events they downloaded before revocation.

## Storage and authorization

Shared definitions, memberships, contribution policies and hashed invitation/link tokens live in `.data/shared-views.sqlite` (or the configured `DATA_DIR`). SQLite transactions prevent invitation replay and lost membership updates. The database and its WAL files remain private runtime data. Existing OAuth accounts, private views and preferences remain in the original private account store.

Every authenticated endpoint checks membership; only owners may change definitions, issue invitations, create/revoke links, or remove other members. Each contribution is fetched with its contributor's Google token, after validating it belongs to their calendar list. Identical provider IDs from different accounts remain separate.

The server redacts events before applying shared filters, so hidden notes or titles cannot affect output. Public output is further restricted to titles and times. Requests recheck membership, link validity and contribution policies after upstream reads to prevent an in-flight read from bypassing a revocation.

Google reads are cached in server memory for at most 60 seconds, keyed by account, calendar and range. Shared screens refresh on open, focus and each minute while visible. Shared events are not added to the persistent personal offline cache or service-worker cache. There is no offline shared-view editing.

## Validation

Tests cover account-bound and single-use invitations, expiration, owner/member permissions, account-qualified provider IDs, Google token isolation, public opt-in, redaction before filtering, member removal, independent link revocation, and safe iCalendar output. A disposable two-account UI fixture also verifies creation, joining, contribution selection and public-link visibility.
