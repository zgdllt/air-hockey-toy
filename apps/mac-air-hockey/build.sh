#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "${ROOT}/../.." && pwd)"
SDK="$(xcrun --show-sdk-path)"
OUT="${ROOT}/build"
mkdir -p "${OUT}"
STAGE="$(mktemp -d "${OUT}/stage.XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT
APP="${STAGE}/AirHockey.app"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources/web"
python3 "${PROJECT}/scripts/air_hockey_stage.py" "${APP}/Contents/Resources/web"
read -r VERSION CODE < <(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); print(v["name"],v["code"])' "${ROOT}/../version.json")
for ARCH in arm64 x86_64; do
    swiftc "${ROOT}/Sources/"*.swift -O -o "${STAGE}/${ARCH}" -sdk "${SDK}" \
        -target "${ARCH}-apple-macosx13.0" -framework Cocoa -framework WebKit
done
lipo -create "${STAGE}/arm64" "${STAGE}/x86_64" -output "${APP}/Contents/MacOS/AirHockey"
cp "${ROOT}/../assets/AirHockey.icns" "${APP}/Contents/Resources/AirHockey.icns"
python3 - "${APP}/Contents/Info.plist" "${VERSION}" "${CODE}" <<'PY'
import plistlib,sys
with open(sys.argv[1], 'wb') as file:
    plistlib.dump(dict(CFBundleDisplayName='一拍即合',CFBundleExecutable='AirHockey',CFBundleIdentifier='com.zgdllt.airhockey.mac',
        CFBundleName='一拍即合',CFBundlePackageType='APPL',CFBundleShortVersionString=sys.argv[2],CFBundleVersion=sys.argv[3],
        CFBundleIconFile='AirHockey',LSMinimumSystemVersion='13.0',NSHighResolutionCapable=True),file)
PY
codesign --force --sign - --timestamp=none "${APP}"
codesign --verify --deep --strict --verbose=2 "${APP}"
# Replace only this script's generated app, never the mixed project checkout.
if [ -d "${OUT}/AirHockey.app" ]; then rm -rf "${OUT}/AirHockey.app"; fi
ditto "${APP}" "${OUT}/AirHockey.app"
mkdir "${STAGE}/disk"
ditto "${APP}" "${STAGE}/disk/AirHockey.app"
ln -s /Applications "${STAGE}/disk/Applications"
cat > "${STAGE}/disk/开始游戏.txt" <<'TXT'
一拍即合 · Air Hockey
把 AirHockey 拖入 Applications，然后打开即可游玩。游戏、音效和宣传片全部在 App 内，无需 Python 或开发工具。
支持 macOS 13 及以上，Apple Silicon / Intel 通用二进制。

此独立发行版未使用 Apple Developer ID 签名或公证。下载后 macOS 可能阻止首次打开：尝试打开后，到「系统设置 → 隐私与安全性」找到此 App 的「仍要打开」。无需关闭系统安全检查。

全屏：点击球桌右上角 ⛶、窗口绿色按钮，或按 Control + Command + F。
退出全屏：再次点击 ×、按 Esc，或按 Control + Command + F。
TXT
hdiutil create -volname '一拍即合 Air Hockey' -srcfolder "${STAGE}/disk" -ov -format UDZO "${OUT}/air-hockey-macos-universal.dmg"
echo "Built ${OUT}/air-hockey-macos-universal.dmg (${VERSION})"
