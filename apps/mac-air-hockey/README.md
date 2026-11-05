# 一拍即合 · macOS App

独立运行的 AppKit / WKWebView 应用。游戏、共享音效、互动宣传片和 30 秒 MP4 均打包在应用内。使用 WKURLSchemeHandler 加载本地资源，不启动服务器，不需要 Python、Node.js 或开发工具。

发行包为 `air-hockey-macos-universal.dmg`。将其中的 `AirHockey.app` 拖入 Applications 即可使用。二进制含 arm64 和 x86_64，部署目标为 macOS 13；本次实机验证使用 Apple Silicon，Intel / macOS 13 硬件尚未实测。

- 全屏支持球桌按钮、窗口绿色按钮和 Control + Command + F；系统退出时同步恢复网页布局。
- 球桌始终等比缩放，横屏 1000:560，竖屏 560:1000；窗口剩余位置留边。
- `haptics.mjs` 为两端共享的事件与节奏表，共 20 种事件，包含连续好球 combo。Mac 使用 NSHapticFeedbackManager 的 generic / alignment / levelChange 以及定时组合；该 API 不能设置与手机完全相同的振幅或波形。实际触感需要支持触觉反馈的触控板。
- 保存战绩图时直接写入「下载」文件夹，使用独立文件名并显示结果提示。
- 切后台或最小化会暂停比赛并取消待执行触感；返回后手动继续。

## 构建与验证

在仓库根运行：

```sh
apps/mac-air-hockey/build.sh
open apps/mac-air-hockey/build/AirHockey.app
apps/mac-air-hockey/build/AirHockey.app/Contents/MacOS/AirHockey --smoke-test /tmp/air-hockey-mac-test
apps/mac-air-hockey/build/AirHockey.app/Contents/MacOS/AirHockey --smoke-test /tmp/air-hockey-mac-online-test --online-smoke
```

构建脚本使用 Command Line Tools，生成通用二进制、封装资源签名及 DMG。`--smoke-test` 是显式诊断参数，检查 WKWebView 游戏加载、全屏等比缩放、系统退出、20 种触感接口调用、互动宣传片、MP4 实际播放和下载目录 PNG 实际写入；诊断结束后只移除自己刚创建的测试 PNG。结果见输出目录 `mac-smoke.json`，失败返回非零。自动化调用不能证明主观触感强度。

`0.3.0` 的好友对战通过公网 WSS 工作，单机继续离线运行；排行榜仅在 B站 Toy 账号上下文中可用。额外加 `--online-smoke` 时，在原生 WKWebView 内创建房间并连接独立第二位对手，确认双方进入比赛后退出。该项会真实访问当前配置的联机服务、创建临时房间；不写入排行榜。

`0.4.0` 增加「关联 B站云档」：App 生成一次性设备码并打开固定的官方 Toy 页面，玩家在浏览器登录 B站、读取私有云档并主动批准，再回 App 排位。App 保留本地游戏凭证，不读取 B站登录令牌。排位、练习战绩和新榜可以跨设备恢复；官方 combo 榜提交仍在 Toy 页面完成。正式关联入口依赖对应 Toy 更新上线。

显式 `--competition-smoke` 可在独立非持久 WK 数据仓验证设备关联、排位开局和对手击球的实际原生 performer 调用；需要外部诊断 authorizer 与对手，并且必须隔离到测试 scope。诊断 authorizer 不是实际 B站登录，调用计数也不能证明主观震动。普通启动不运行诊断，不导出凭证。

## 触感对照工具

`Diagnostics/HapticProbe.swift` 是独立的原生诊断应用，不修改游戏或系统触控板设置。用触控板移动光标，在四个区域上下划过横线：

| 区域 | 调用路径 |
| --- | --- |
| A | 原生鼠标事件中立即调用 `.now` |
| B | 原生鼠标事件中调用 `.default`，请求绘制以同步触感 |
| C | 网页 `pointerenter` 消息的原生回调中同步调用 `.now` |
| D | 同一网页消息转到主队列后调用 `.now` |

每个区域从上到下覆盖相同的 `generic`、`alignment`、`levelChange` 模式。计数与 JSONL 日志证明调用发生，不能证明物理震动。菜单「显示调用记录」会打开 `~/Library/Logs/AirHockeyHapticsTest/events.jsonl` 所在位置；显式传入文件路径可保留独立测试记录。

```sh
bash apps/mac-air-hockey/Diagnostics/build.sh
open apps/mac-air-hockey/Diagnostics/build/触感对照.app
```

该工具已另存到本机 `/Applications/触感对照.app`，无需开发工具即可运行。此次排查先观察到游戏 19 类事件均调用实际触控板 performer、用户仍无触感；随后用户在四区对照中确认测试应用和原有 Air Hockey 均恢复触感。恢复时未修改游戏代码，具体原因尚未确定，因此未发布声称修复触感的补丁。

## 首次打开

当前发行包只有 ad-hoc 签名，没有 Apple Developer ID 签名或公证。通过互联网下载后 macOS 可能阻止首次打开。先尝试打开，再按系统提示到「系统设置 → 隐私与安全性」选择此应用的「仍要打开」。不要关闭系统的安全检查。要实现没有这一拦截的分发，需要后续提供 Developer ID 证书并完成公证。
