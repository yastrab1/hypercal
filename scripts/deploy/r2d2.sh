#!/usr/bin/env bash
# Run only from the trusted main deployment job on the dedicated R2D2 runner.
set -euo pipefail
: "${GITHUB_SHA:?}" "${ANDROID_ARTIFACT_DIR:?}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
root=/home/r2d2/hypercal
compose=/home/r2d2/unified/docker-compose.yml
origin=https://r2d2.tail6caf54.ts.net:10000
exec 9>"$root/.deploy.lock"
flock 9

# Validate the exact successful CI artifact before changing live files.
python3 - "$ANDROID_ARTIFACT_DIR" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); m=json.loads((p/'android-update.json').read_text())
a=(p/'hypercal-debug.apk').read_bytes()
assert m['packageId']=='app.hypercal.calendar'
assert m['versionCode']>0 and m['download']=='/download'
assert m['size']==len(a) and m['sha256']==hashlib.sha256(a).hexdigest()
assert (p/'hypercal-debug.apk.sha256').read_text().split()[0]==m['sha256']
print('Verified Android artifact:',m['versionName'],m['versionCode'],m['sha256'])
PY
image="hypercal:sha-$GITHUB_SHA"
docker build --label "org.opencontainers.image.revision=$GITHUB_SHA" -t "$image" .
if [[ "$(git ls-remote origin refs/heads/main | cut -f1)" != "$GITHUB_SHA" ]]; then
  echo 'A newer main build superseded this deployment.'
  exit 0
fi
container=$(docker compose -f "$compose" ps -q hypercal)
test -n "$container"
previous=$(docker inspect "$container" --format '{{.Image}}')
backup=$(mktemp -d "$root/.deploy-backup.XXXXXXXX")
cp -a "$root/dist/downloads/." "$backup/"
rollback() {
  echo 'Deployment failed; restoring previous image and Android downloads.' >&2
  cp -a "$backup/." "$root/dist/downloads/"
  docker tag "$previous" hypercal:local
  docker compose -f "$compose" up -d --no-deps --no-build hypercal
}
trap rollback ERR
# Publish payloads first and metadata last. The updater rejects any transient
# mismatch; never replace the bind-mounted directory itself.
for name in hypercal-debug.apk hypercal-debug.apk.sha256 android-update.json; do
  install -m 644 "$ANDROID_ARTIFACT_DIR/$name" "$root/dist/downloads/.$name.next"
  mv -f "$root/dist/downloads/.$name.next" "$root/dist/downloads/$name"
done
docker tag "$image" hypercal:local
docker compose -f "$compose" up -d --no-deps --no-build hypercal
for attempt in $(seq 1 30); do
  container=$(docker compose -f "$compose" ps -q hypercal)
  health=$(docker inspect "$container" --format '{{.State.Health.Status}}')
  [[ "$health" == healthy ]] && break
  [[ "$health" != unhealthy ]]
  sleep 2
done
test "$health" = healthy
test "$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$GITHUB_SHA"
verify=$(mktemp -d)
curl --retry 3 --retry-all-errors -fsS "$origin/api/health"
curl --retry 3 --retry-all-errors -fsS "$origin/downloads/android-update.json" -o "$verify/android-update.json"
curl --retry 3 --retry-all-errors -fsS "$origin/download" -o "$verify/hypercal-debug.apk"
cmp "$ANDROID_ARTIFACT_DIR/android-update.json" "$verify/android-update.json"
cmp "$ANDROID_ARTIFACT_DIR/hypercal-debug.apk" "$verify/hypercal-debug.apk"
curl --retry 3 --retry-all-errors -fsS "$origin/" -o "$verify/index.html"
docker cp "$container:/app/dist/index.html" "$verify/image-index.html"
cmp "$verify/index.html" "$verify/image-index.html"
# Keep the operator checkout current, preserving runtime/private configuration.
rsync -a --exclude=.git --exclude=.env --exclude='.env.*' --exclude=.data \
  --exclude=node_modules --exclude=dist --exclude=artifacts --exclude=android \
  --exclude='.deploy*' ./ "$root/"
printf '%s\n' "$GITHUB_SHA" > "$root/.deployed-sha"
trap - ERR
rm -rf "$verify" "$backup"
echo "Deployed and verified $GITHUB_SHA at $origin"
