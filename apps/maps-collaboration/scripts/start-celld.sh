#!/bin/sh
set -eu

export CELLD_BUCKET="${CELLD_BUCKET:-sqlite:///app/.celld/object-store/objects.sqlite3}"
export CELLD_ESBUILD="${CELLD_ESBUILD:-$(node -p 'require.resolve("esbuild/bin/esbuild")')}"
mkdir -p /app/.celld/object-store
celld diagnose --bucket "$CELLD_BUCKET" --no-control-plane
celld deploy . --bucket "$CELLD_BUCKET"
exec celld --no-control-plane
