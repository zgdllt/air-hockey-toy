# 一拍即合 · macOS App

独立运行的 AppKit / WKWebView 应用。游戏、共享音效、互动宣传片和 30 秒 MP4 均打包在应用内。使用 WKURLSchemeHandler 加载本地资源，不启动服务器，不需要 Python、Node.js 或开发工具。

发行包为 `air-hockey-macos-universal.dmg`。将其中的 `AirHockey.app` 拖入 Applications 即可使用。二进制含 arm64 和 x86_64，部署目标为 macOS 13；本次实机验证使用 Apple Silicon，Intel / macOS 13 硬件尚未实测。

- 全屏支持球桌按钮、窗口绿色按钮和 Control + Command + F；系统退出时同步恢复网页布局。
- 球桌始终等比缩放，横屏 1000:560，竖屏 560:1000；窗口剩余位置留边。
- `haptics.mjs` 为两端共享的事件与节奏表。Mac 使用 NSHapticFeedbackManager 的 generic / alignment / levelChange 以及定时组合；该 API 不能设置与手机完全相同的振幅或波形。实际触感需要支持触觉反馈的触控板。
- 保存战绩图时直接写入「下载」文件夹，使用独立文件名并显示结果提示。
- 切后台或最小化会暂停比赛并取消待执行触感；返回后手动继续。

## 构建与验证

在仓库根运行：

```sh
apps/mac-air-hockey/build.sh
open apps/mac-air-hockey/build/AirHockey.app
apps/mac-air-hockey/build/AirHockey.app/Contents/MacOS/AirHockey --smoke-test /tmp/air-hockey-mac-test
```

构建脚本使用 Command Line Tools，生成通用二进制、封装资源签名及 DMG。`--smoke-test` 是显式诊断参数，检查 WKWebView 游戏加载、全屏等比缩放、系统退出、19 种触感接口调用、互动宣传片、MP4 实际播放和下载目录 PNG 实际写入；诊断结束后只移除自己刚创建的测试 PNG。结果见输出目录 `mac-smoke.json`，失败返回非零。自动化调用不能证明主观触感强度。

## 首次打开

当前发行包只有 ad-hoc 签名，没有 Apple Developer ID 签名或公证。通过互联网下载后 macOS 可能阻止首次打开。先尝试打开，再按系统提示到「系统设置 → 隐私与安全性」选择此应用的「仍要打开」。不要关闭系统的安全检查。要实现没有这一拦截的分发，需要后续提供 Developer ID 证书并完成公证。
