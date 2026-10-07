#!/bin/sh
set -eu

if [ -n "${CELLD_VARS_FILE:-}" ] && [ ! -r "$CELLD_VARS_FILE" ]; then
  echo "CELLD_VARS_FILE is not readable" >&2
  exit 1
fi
if [ -z "${CELLD_VARS_FILE:-}" ] && [ -z "${CELLD_VAR_REF_PASSWORD:-}" ]; then
  echo "REF_PASSWORD is not configured" >&2
  exit 1
fi

mkdir -p /app/.celld/object-store /app/.celld/state
export CELLD_ESBUILD=/app/node_modules/.bin/esbuild

attempt=0
until celld diagnose --bucket "$CELLD_BUCKET" --no-control-plane; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Celld storage did not become ready" >&2
    exit 1
  fi
  sleep 1
done

celld deploy . --bucket "$CELLD_BUCKET"
exec celld --no-control-plane
