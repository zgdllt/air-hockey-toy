#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "${ROOT}/../.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
TOOLS="${SDK_ROOT}/build-tools/37.0.0"
PLATFORM="${SDK_ROOT}/platforms/android-36.1"
OUT="${ROOT}/build"
mkdir -p "${OUT}"
STAGE="$(mktemp -d "${OUT}/stage.XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT
mkdir -p "${STAGE}/assets" "${STAGE}/classes" "${STAGE}/dex"
python3 "${PROJECT}/scripts/air_hockey_stage.py" "${STAGE}/assets"
read -r VERSION CODE < <(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); print(v["name"],v["code"])' "${ROOT}/../version.json")
find "${ROOT}/src/com" -name '*.java' -print0 | xargs -0 javac -source 8 -target 8 -classpath "${PLATFORM}/android.jar" -d "${STAGE}/classes"
find "${STAGE}/classes" -name '*.class' -print0 | xargs -0 "${TOOLS}/d8" --min-api 26 --lib "${PLATFORM}/android.jar" --output "${STAGE}/dex"
"${TOOLS}/aapt2" compile --dir "${ROOT}/res" -o "${STAGE}/resources.zip"
"${TOOLS}/aapt2" link -o "${STAGE}/unsigned.apk" -I "${PLATFORM}/android.jar" \
    --manifest "${ROOT}/AndroidManifest.xml" -A "${STAGE}/assets" "${STAGE}/resources.zip" \
    --min-sdk-version 26 --target-sdk-version 36 --version-code "${CODE}" --version-name "${VERSION}"
(cd "${STAGE}/dex" && zip -q -u "${STAGE}/unsigned.apk" classes.dex)
"${TOOLS}/zipalign" -f -p 4 "${STAGE}/unsigned.apk" "${STAGE}/aligned.apk"
SIGNING="${AIR_HOCKEY_SIGNING_DIR:-$HOME/.local/share/air-hockey/signing}"
mkdir -p "${SIGNING}"
chmod 700 "${SIGNING}"
# Preserve the certificate used by the user's installed first build for upgrades.
# This private key and password file are never copied into source or artifacts.
if [ ! -f "${SIGNING}/app.keystore" ]; then
    if [ -f "${OUT}/debug.keystore" ]; then
        cp "${OUT}/debug.keystore" "${SIGNING}/app.keystore"
        printf '%s\n' android > "${SIGNING}/password"
    else
        python3 -c 'import secrets,sys; open(sys.argv[1],"w").write(secrets.token_urlsafe(32))' "${SIGNING}/password"
        keytool -genkeypair -keystore "${SIGNING}/app.keystore" -storepass:file "${SIGNING}/password" \
            -keypass:file "${SIGNING}/password" -alias androiddebugkey -keyalg RSA -keysize 3072 -validity 10000 \
            -dname 'CN=Air Hockey,O=zgdllt,C=CN' >/dev/null 2>&1
    fi
fi
chmod 600 "${SIGNING}/app.keystore" "${SIGNING}/password"
"${TOOLS}/apksigner" sign --ks "${SIGNING}/app.keystore" --ks-pass "file:${SIGNING}/password" \
    --out "${OUT}/air-hockey-android.apk" "${STAGE}/aligned.apk"
"${TOOLS}/apksigner" verify --verbose "${OUT}/air-hockey-android.apk"
echo "Built ${OUT}/air-hockey-android.apk (${VERSION})"
