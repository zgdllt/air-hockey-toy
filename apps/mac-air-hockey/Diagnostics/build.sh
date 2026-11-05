#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${ROOT}/build"
mkdir -p "${OUT}"
STAGE="$(mktemp -d "${OUT}/stage.XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT
APP="${STAGE}/触感对照.app"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
for ARCH in arm64 x86_64; do
    swiftc "${ROOT}/HapticProbe.swift" -O -o "${STAGE}/${ARCH}" \
        -target "${ARCH}-apple-macosx13.0" -framework Cocoa -framework WebKit
done
lipo -create "${STAGE}/arm64" "${STAGE}/x86_64" -output "${APP}/Contents/MacOS/HapticProbe"
cp "${ROOT}/../../assets/AirHockey.icns" "${APP}/Contents/Resources/AirHockey.icns"
python3 - "${APP}/Contents/Info.plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "wb") as file:
    plistlib.dump(dict(
        CFBundleName="触感对照", CFBundleDisplayName="触感对照",
        CFBundleIdentifier="com.zgdllt.airhockey.hapticprobe",
        CFBundleExecutable="HapticProbe", CFBundlePackageType="APPL",
        CFBundleShortVersionString="1.0", CFBundleVersion="1",
        CFBundleIconFile="AirHockey", LSMinimumSystemVersion="13.0",
        NSHighResolutionCapable=True,
    ), file)
PY
codesign --force --sign - --timestamp=none "${APP}"
codesign --verify --deep --strict --verbose=2 "${APP}"
ditto "${APP}" "${OUT}/触感对照.app"
echo "Built ${OUT}/触感对照.app"
