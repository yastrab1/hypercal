# HyperCal in the R2D2 unified stack

`docker-compose.hypercal.yml` is included by `/home/r2d2/unified/docker-compose.yml`. The source checkout is `/home/r2d2/hypercal` by default. Set `HYPERCAL_ROOT`, `HYPERCAL_UID` and `HYPERCAL_GID` if those differ on another host.

The service binds only `127.0.0.1:3791`. It reads the existing private `.env`, mounts the existing `.data` directory at `/data`, and mounts `dist/downloads` read-only for APK delivery. Existing accounts, the session signing key, private views, preferences and the shared-view SQLite database remain in place. The image runs as UID/GID 1000 with a read-only root filesystem.

Manage only this service, preserving other stack services and their overlays:

```sh
cd /home/r2d2/unified
docker compose -f docker-compose.yml build hypercal
docker compose -f docker-compose.yml up -d --no-deps hypercal
docker compose -f docker-compose.yml logs --tail 50 hypercal
```

The former `systemctl --user hypercal` service is disabled after the container becomes healthy. To roll back, stop the Compose service before starting that unit; both use the same loopback port and persistent data directory.

## Public entry point

The host's existing Tailscale daemon manages Funnel:

```sh
tailscale funnel --bg --https=10000 http://127.0.0.1:3791
tailscale funnel status
```

The public URL is `https://r2d2.tail6caf54.ts.net:10000`. Ports 443 and 8443 already serve other private services, so they are unchanged. Funnel permission is scoped to R2D2's Tailscale IP rather than all tailnet members. Host Tailscale configuration persists separately from the application container; rebuilding the container does not reset the tailnet's Serve/Funnel configuration.

The private application `.env` uses that public URL as `APP_URL`, with `TRUST_PROXY=1` and `COOKIE_SECURE=true`. `ALLOWED_ORIGINS` retains the earlier private origin during the Android endpoint migration; it permits that exact origin without bypassing session authentication or CSRF tokens. Google OAuth also retains the older registered callbacks, adding the public URL followed by `/auth/google/callback`.

To disable just HyperCal's public entry point:

```sh
tailscale funnel --https=10000 off
```

Do not reset the whole Serve/Funnel configuration: other services use it.

## CI deployment

`.github/workflows/deploy.yml` follows successful `main` push runs of **Build and
 test**. A repository-scoped runner named `hypercal-r2d2-deploy` on R2D2 has only
 the custom `hypercal-deploy-r2d2` label. It runs as the existing `r2d2` user via
 `systemctl --user status hypercal-actions-runner.service`; its installation is
 `/home/r2d2/hypercal-actions-runner`. No SSH key or personal GitHub token is
 stored in CI. Registration uses GitHub's short-lived runner registration token.

The deployment checks out the successful build's exact SHA, skips superseded
main builds, downloads its signed Android artifact, and verifies its checksum
and update metadata. `scripts/deploy/r2d2.sh` builds an image labeled with that
SHA and recreates only `hypercal`. The browser worker, account data and private
configuration remain in place. Payload files are replaced atomically and update
metadata is published last, preserving the existing downloads bind mount.

CI verifies container health, image revision, public HTML, update metadata and
the complete downloaded APK. Failure restores the previous image and Android
files. The last successful SHA is recorded in `/home/r2d2/hypercal/.deployed-sha`.
The dedicated runner uses [GitHub's service entry point](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=linux)
under the existing user service manager, which has lingering enabled.
