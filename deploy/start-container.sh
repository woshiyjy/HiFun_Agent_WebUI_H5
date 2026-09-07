#!/bin/sh
set -eu
# Run on the authorized ECS after provisioning config/app.env over SSH.
release=${1:?Usage: start-container.sh IMAGE_TAG}
case "$release" in *[!a-zA-Z0-9._-]*) exit 2;; esac
base=/opt/hifun-xiaozhi
test -s "$base/config/app.env"
docker image inspect "hifun-xiaozhi:$release" >/dev/null
if docker container inspect hifun-xiaozhi >/dev/null 2>&1; then
  echo 'Existing container detected; preserve its version and use the reviewed upgrade procedure.' >&2
  exit 1
fi
docker run -d --name hifun-xiaozhi \
  --network host --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 256 \
  --log-opt max-size=10m --log-opt max-file=3 \
  --env-file "$base/config/app.env" \
  --mount "type=bind,src=$base/runtime,dst=/app/.runtime" \
  "hifun-xiaozhi:$release"
