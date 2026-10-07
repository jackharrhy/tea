#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
steamcmd_bin="${STEAMCMD_BIN:-steamcmd}"
steam_account="${STEAM_ACCOUNT:-}"
steam_library="${MAPS_STEAM_LIBRARY:-${HOME}/.local/share/Steam}"
install_root="${MAPS_STEAM_INSTALL_ROOT:-${repo_root}/local/steam-installs}"
corpus_root="${MAPS_STEAM_CORPUS_ROOT:-${repo_root}/local/steam-corpus}"

declare -A app_names=(
  [10]='Counter-Strike'
  [20]='Team Fortress Classic'
  [30]='Day of Defeat'
  [40]='Deathmatch Classic'
  [50]='Half-Life: Opposing Force'
  [60]='Ricochet'
  [70]='Half-Life'
  [80]='Counter-Strike: Condition Zero'
  [130]='Half-Life: Blue Shift'
  [2310]='Quake'
  [2320]='Quake II'
  [214700]='Thirty Flights of Loving + Gravity Bone'
  [225840]='Sven Co-op'
  [1000410]='WRATH: Aeon of Ruin'
  [3191050]='BRAZILIAN DRUG DEALER 3'
  [4484420]='FLESHCANCER'
)

declare -A app_platforms=(
  [10]='linux'
  [20]='linux'
  [30]='linux'
  [40]='linux'
  [50]='linux'
  [60]='linux'
  [70]='linux'
  [80]='linux'
  [130]='linux'
  [2310]='windows'
  [2320]='windows'
  [214700]='linux'
  [225840]='linux'
  [1000410]='linux'
  [3191050]='windows'
  [4484420]='windows'
)

usage() {
  cat <<'EOF'
Usage: npm run corpus:steam -- [research|supported|all|APP_ID[:PLATFORM] ...]

Presets:
  research   Thirty Flights/Gravity Bone and FLESHCANCER (default)
  supported  Research plus Quake, Quake II, GoldSrc games, Sven Co-op, and AVIAOZIN3
  all        Supported plus WRATH, if the account owns it

The script prompts for the Steam login name when STEAM_ACCOUNT is unset. SteamCMD then prompts for
the password and Steam Guard code; neither secret is accepted on the command line. Existing
standard Steam-library installs are reused. Downloads and extracted BSPs stay under the ignored
apps/maps/local directory by default.

Environment overrides:
  STEAMCMD_BIN, STEAM_ACCOUNT, MAPS_STEAM_LIBRARY,
  MAPS_STEAM_INSTALL_ROOT, MAPS_STEAM_CORPUS_ROOT,
  MAPS_STEAM_REFRESH=1, MAPS_STEAM_EXTRACT_ONLY=1,
  MAPS_STEAM_SKIP_CHECK=1
EOF
}

resolve_selection() {
  local requested=("$@")
  if [[ ${#requested[@]} -eq 0 ]]; then requested=(research); fi
  case "${requested[0]}" in
    research)
      app_specs=(214700 4484420)
      ;;
    supported)
      app_specs=(214700 4484420 2310 2320 70 50 130 10 20 30 40 60 80 225840 3191050)
      ;;
    all)
      app_specs=(214700 4484420 2310 2320 70 50 130 10 20 30 40 60 80 225840 3191050 1000410)
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      app_specs=("${requested[@]}")
      ;;
  esac
}

existing_install() {
  local app_id="$1"
  local manifest="${steam_library}/steamapps/appmanifest_${app_id}.acf"
  [[ -f "$manifest" ]] || return 1
  local install_directory
  install_directory="$(awk -F '"' '/"installdir"/ { print $4; exit }' "$manifest")"
  [[ -n "$install_directory" ]] || return 1
  local path="${steam_library}/steamapps/common/${install_directory}"
  [[ -d "$path" ]] || return 1
  printf '%s\n' "$path"
}

download_app() {
  local app_id="$1"
  local platform="$2"
  local target="$3"
  local name="${app_names[$app_id]:-Steam app ${app_id}}"
  if [[ -z "$steam_account" ]]; then
    read -r -p 'Steam login account name: ' steam_account
    [[ -n "$steam_account" ]] || {
      printf 'A Steam login account name is required.\n' >&2
      return 1
    }
  fi
  printf '\nDownloading %s (%s, %s)\n' "$name" "$app_id" "$platform"
  "$steamcmd_bin" \
    +@ShutdownOnFailedCommand 1 \
    +@sSteamCmdForcePlatformType "$platform" \
    +force_install_dir "$target" \
    +login "$steam_account" \
    +app_update "$app_id" validate \
    +quit
}

resolve_selection "$@"
if [[ "${MAPS_STEAM_EXTRACT_ONLY:-0}" != '1' ]]; then
  command -v "$steamcmd_bin" >/dev/null || {
    printf 'SteamCMD is unavailable: %s\n' "$steamcmd_bin" >&2
    exit 1
  }
fi
command -v unzip >/dev/null || {
  printf 'unzip is required to inspect PK3 archives\n' >&2
  exit 1
}
mkdir -p "$install_root" "$corpus_root"

sources=()
failures=()
for specification in "${app_specs[@]}"; do
  app_id="${specification%%:*}"
  [[ "$app_id" =~ ^[0-9]+$ ]] || {
    printf 'Invalid app specification: %s\n' "$specification" >&2
    exit 1
  }
  platform="${specification#*:}"
  if [[ "$platform" == "$specification" ]]; then
    platform="${app_platforms[$app_id]:-linux}"
  fi
  [[ "$platform" == 'linux' || "$platform" == 'windows' || "$platform" == 'macos' ]] || {
    printf 'Unsupported Steam platform in %s\n' "$specification" >&2
    exit 1
  }

  source_path=''
  if [[ "${MAPS_STEAM_REFRESH:-0}" != '1' ]]; then
    source_path="$(existing_install "$app_id" || true)"
  fi
  if [[ -n "$source_path" ]]; then
    printf 'Reusing installed %s (%s): %s\n' "${app_names[$app_id]:-Steam app}" "$app_id" "$source_path"
  else
    source_path="${install_root}/${app_id}"
    if [[ "${MAPS_STEAM_EXTRACT_ONLY:-0}" != '1' ]]; then
      if ! download_app "$app_id" "$platform" "$source_path"; then
        failures+=("$app_id")
        continue
      fi
    elif [[ ! -d "$source_path" ]]; then
      printf 'Skipping unavailable extract-only source for app %s\n' "$app_id" >&2
      failures+=("$app_id")
      continue
    fi
  fi
  sources+=(--source "${app_id}=${source_path}")
done

if [[ ${#sources[@]} -eq 0 ]]; then
  printf 'No Steam game directories were available to scan.\n' >&2
  exit 1
fi

if ! node "${repo_root}/scripts/extract-bsp-corpus.mjs" --output "$corpus_root" "${sources[@]}"; then
  printf 'BSP extraction failed.\n' >&2
  exit 1
fi
compatibility_failed=0
if [[ "${MAPS_STEAM_SKIP_CHECK:-0}" != '1' ]]; then
  if ! (
    cd "$repo_root"
    npm run corpus:check -- "${corpus_root}/manifest.json"
  ); then
    compatibility_failed=1
  fi
fi
if [[ ${#failures[@]} -gt 0 ]]; then
  printf 'Unavailable app IDs (usually not owned): %s\n' "${failures[*]}" >&2
fi
printf 'Manifest: %s/manifest.json\n' "$corpus_root"
if [[ $compatibility_failed -eq 1 ]]; then
  printf 'One or more BSP files failed compatibility checks.\n' >&2
  exit 1
fi
