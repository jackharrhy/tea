#!/bin/sh
set -eu

export CELLD_BUCKET="${CELLD_BUCKET:-sqlite:///app/.celld/object-store/objects.sqlite3}"
export CELLD_ESBUILD="${CELLD_ESBUILD:-$(node -p 'require.resolve("esbuild/bin/esbuild")')}"
deploy_config="${TEA_MAPS_CELLD_DEPLOY_CONFIG:-.}"
case "$deploy_config" in
  .|wrangler.celld-cutover.jsonc) ;;
  *) echo "TEA_MAPS_CELLD_DEPLOY_CONFIG must select the default or cutover config" >&2; exit 1 ;;
esac

mkdir -p /app/.celld/object-store
celld diagnose --bucket "$CELLD_BUCKET" --no-control-plane
celld deploy "$deploy_config" --bucket "$CELLD_BUCKET"
exec celld --no-control-plane
