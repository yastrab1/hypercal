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
