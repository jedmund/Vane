#!/bin/sh
set -e

# Resolve the SearXNG instance secret. Precedence:
#   1. $SEARXNG_SECRET from the environment (operator override).
#   2. A persisted file in the data volume (auto-generated on first boot).
# The secret only matters when this bundled SearXNG is the one being queried;
# our homelab points SEARXNG_API_URL at an external instance and ignores
# this. Upstream/self-hosted users still get a smooth experience: they don't
# have to think about it, but the secret stays stable across restarts.
SEARXNG_SETTINGS='/etc/searxng/settings.yml'
SEARXNG_SECRET_FILE='/home/vane/data/searxng.secret'

if [ -z "${SEARXNG_SECRET}" ]; then
  if [ -f "${SEARXNG_SECRET_FILE}" ]; then
    SEARXNG_SECRET="$(cat "${SEARXNG_SECRET_FILE}")"
  else
    mkdir -p "$(dirname "${SEARXNG_SECRET_FILE}")"
    # python3 instead of openssl: openssl CLI is not in the node:24-slim
    # base image, but python3 is already installed for SearXNG itself.
    # 32 bytes -> 64 hex chars; matches what SearXNG ships as an example
    # and what the previous hardcoded value was.
    SEARXNG_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    # umask before write so the file lands at 0600 even on filesystems
    # that don't honor a post-hoc chmod (some bind mounts).
    ( umask 077 && printf '%s' "${SEARXNG_SECRET}" > "${SEARXNG_SECRET_FILE}" )
    chmod 600 "${SEARXNG_SECRET_FILE}" 2>/dev/null || true
    echo "Generated SearXNG secret at ${SEARXNG_SECRET_FILE}"
  fi
fi

# Substitute the placeholder shipped in the image. Use a delimiter that
# can't appear in a hex string so we never trip over special chars.
sed -i "s|__SEARXNG_SECRET__|${SEARXNG_SECRET}|" "${SEARXNG_SETTINGS}"

echo "Starting SearXNG..."

sudo -H -u searxng bash -c "cd /usr/local/searxng/searxng-src && export SEARXNG_SETTINGS_PATH='/etc/searxng/settings.yml' && export FLASK_APP=searx/webapp.py && /usr/local/searxng/searx-pyenv/bin/python -m flask run --host=0.0.0.0 --port=8080" &
SEARXNG_PID=$!

echo "Waiting for SearXNG to be ready..."
sleep 5

COUNTER=0
MAX_TRIES=30
until curl -s http://localhost:8080 > /dev/null 2>&1; do
  COUNTER=$((COUNTER+1))
  if [ $COUNTER -ge $MAX_TRIES ]; then
    echo "Warning: SearXNG health check timeout, but continuing..."
    break
  fi
  sleep 1
done

if curl -s http://localhost:8080 > /dev/null 2>&1; then
  echo "SearXNG started successfully (PID: $SEARXNG_PID)"
else
  echo "SearXNG may not be fully ready, but continuing (PID: $SEARXNG_PID)"
fi

cd /home/vane
echo "Starting Vane..."

exec node server.js