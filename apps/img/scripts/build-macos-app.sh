#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
cargo build --locked --release
bundle_dir="$project_dir/artifacts/img.app"
mkdir -p "$bundle_dir/Contents/MacOS" "$bundle_dir/Contents/Resources"
cp "${CARGO_TARGET_DIR:-target}/release/img" "$bundle_dir/Contents/MacOS/img.next"
mv -f "$bundle_dir/Contents/MacOS/img.next" "$bundle_dir/Contents/MacOS/img"
cp assets/icon.icns "$bundle_dir/Contents/Resources/icon.icns"
mkdir -p "$bundle_dir/Contents/Resources/licenses/fonts"
cp assets/fonts/LICENSE.txt "$bundle_dir/Contents/Resources/licenses/fonts/Inter.txt"
for family in anton bangers bebasneue; do
    cp "assets/fonts/$family/OFL.txt" "$bundle_dir/Contents/Resources/licenses/fonts/$family.txt"
done
python3 - "$bundle_dir" <<'PY'
import json
import plistlib
import subprocess
import sys
from pathlib import Path

metadata = json.loads(subprocess.check_output(
    ['cargo', 'metadata', '--no-deps', '--format-version', '1'], text=True))
version = next(package['version'] for package in metadata['packages'] if package['name'] == 'img')
bundle = Path(sys.argv[1])
(bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({
    'CFBundleName': 'img',
    'CFBundleDisplayName': 'img',
    'CFBundleIdentifier': 'local.img.editor',
    'CFBundleExecutable': 'img',
    'CFBundleIconFile': 'icon.icns',
    'CFBundlePackageType': 'APPL',
    'CFBundleShortVersionString': version,
    'CFBundleVersion': version,
    'NSHighResolutionCapable': True,
}))
print(bundle)
PY
