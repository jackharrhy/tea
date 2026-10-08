#!/bin/sh
set -eu
mkdir -p /app/.celld/object-store /app/.celld/state
export CELLD_ESBUILD=/app/node_modules/.bin/esbuild
celld diagnose --bucket "$CELLD_BUCKET" --no-control-plane
celld deploy . --bucket "$CELLD_BUCKET"
exec celld --no-control-plane
