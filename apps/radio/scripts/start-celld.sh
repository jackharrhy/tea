#!/bin/sh
set -eu

export CELLD_BUCKET="${CELLD_BUCKET:-sqlite:///app/.celld/object-store/objects.sqlite3}"

case "$CELLD_BUCKET" in
  sqlite:///*) set -- --no-control-plane "$@" ;;
  az://*)
    export AZURE_STORAGE_USE_EMULATOR="${AZURE_STORAGE_USE_EMULATOR:-true}"
    if [ "$AZURE_STORAGE_USE_EMULATOR" = "true" ] || [ "$AZURE_STORAGE_USE_EMULATOR" = "1" ]; then
      export AZURE_STORAGE_ACCOUNT_NAME="${AZURE_STORAGE_ACCOUNT_NAME:-devstoreaccount1}"
    fi
    ;;
esac

node "$(dirname "$0")/prepare-celld.mjs"
exec "${CELLD_BIN:-celld}" "$@"
