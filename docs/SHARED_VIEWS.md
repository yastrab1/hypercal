# Shared views: next phase

Status: planned, not exposed by the prototype. Existing views are private, versioned definitions with an owner. A view never changes the visibility or ACL of its source Google calendars.

## Experience

1. An owner creates a view and selects “Invite people”. The invitation is restricted to named Google identities, with an expiring single-use invitation token. Invitees sign in with their own Google account.
2. A member sees exactly which people have access and chooses calendars to contribute. No calendar is contributed automatically. They can contribute details, title-only, or free/busy; the least detail needed is the default.
3. Members see the combined contributed events through the shared view’s filters. Changing a filter does not modify any Google calendar or event. Members can remove a contribution or leave immediately.
4. Owners can create a revocable read-only view link. Link sharing is off by default. The owner reviews a preview of precisely what the link reveals. Notes, meeting URLs, locations and attendee lists are excluded by default. Every contributor must opt into link visibility; an owner cannot publicly expose another member’s calendar by themselves.
5. Links to the app and exported iCalendar subscription links are distinct controls. Both use high-entropy opaque tokens, can expire, and are independently revocable. Calendar clients may retain downloaded events even after a link is revoked; explain that at publication time.

## Data model

Migrate the private JSON prototype store to SQLite/PostgreSQL before exposing invitations.

- `users`: Google subject (stable ID), email, encrypted tokens, timezone.
- `views`: ID, owner ID, name, layout, schema version, filter JSON, visibility (private/invite/link).
- `view_members`: view ID, user ID, role (owner/editor/viewer), invitation status, accepted timestamp. Unique by view/user.
- `calendar_contributions`: view ID, contributing user ID, provider calendar ID, detail policy, link-sharing opt-in. Calendar references are qualified by account as well as calendar ID.
- `invitations`: view, invited identity, token hash, expiry, accepted timestamp. Tokens must be consumed once.
- `share_links`: view ID, token hash, scope (app-read/ical), allowed detail policy, expiry, revoked timestamp, creator.
- `audit_log`: membership, contributions, link creation/revocation and policy changes. Never log OAuth tokens or feed secrets.

## Authorization and sync

Authenticate each member separately. Resolve a contribution using only its contributor’s Google token. A membership never grants a Google Calendar ACL. Invitees do not get access to a contributor’s raw feed URL or token. Apply the contributor’s detail policy before shared-view filtering to prevent filters from leaking hidden text. Filter, redact, then serialize consistently for both web and iCalendar export.

Only source owners/writers may edit source events, and only through their own Google permissions. Viewing a shared calendar does not grant editing. Shared-view editors may adjust layout and agreed filters but cannot widen another member’s contribution policy. Enforce all checks on the server and test account isolation, removed members, revoked links, expired invites, and indirect data leaks.

Use Google incremental sync tokens and renewed watch channels for scale. The prototype reads Google directly with minute/focus refreshes; shared views must add per-account caches, invalidation and refresh coordination. A lost OAuth grant hides that contribution and clearly reports the issue to its owner. Avoid copying private data into public persistent caches.

## Boundaries for this prototype

No invitations, friend calendar aggregation, public links or iCalendar export links are active. Private view definitions already carry `ownerId`, `visibility: private` and `schemaVersion: 1`, leaving a migration path. Current imported/subscribed calendars are read-only within HyperCal and are not added to Google’s calendar list.
