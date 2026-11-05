# Air Hockey v0.3.0

本次新增顶部连击反馈、单局最高好球 combo 排行榜及公网好友对战。网页、Android 与 Mac 使用同一份 26 项运行资源；单机可离线运行，好友场需要联网。

- 连击榜仅在正式 B站 Toy 账号上下文可用，按热身 / 标准 / 挑战分榜；玩家在单机结算后主动提交。网页与原生好友场均不提交到单机榜。
- 好友对战：创建六位房间码、另一端加入、双方准备、先得五分、再来一局。后台共同暂停，返回后手动继续。房间为单实例内存状态，服务重启后需重新建房；不提供账户排位或原局断线续传。
- Mac：macOS 13+，Apple Silicon / Intel 通用 DMG，内置图标、音效、互动宣传片和 30 秒 MP4。实际 Apple Silicon WKWebView、全屏等比缩放、PNG 保存、视频播放和公网房间开赛已验证；Intel 硬件未实测。使用 ad-hoc 签名，未做 Developer ID 签名 / 公证，首次打开可能需在系统“隐私与安全性”中确认。
- Android：API 26+，VIBRATE 与 INTERNET 权限，保留原有签名证书。APK 签名及全部运行资源校验通过；此版本尚未完成小米实机联机复测。
- 两端共享 20 类触感事件；桥接调用测试不代表物理触感强度一致。独立的 Mac 触感对照工具源码保存在 `apps/mac-air-hockey/Diagnostics/`。

验证包含服务端房间状态测试、客户端映射 / 取消连接、combo 与触感回归；两个实际 Toy iframe 和公网 WSS 双连接已开局，后者实际击球和进球，并核对比分一致。没有向真实榜单提交测试分数；真实提交待更新后的 Toy 页面由登录玩家验证。

源码只同步明确白名单，无设备 SDK jar、keystore、密码、构建目录或本机日志。`SOURCE-MANIFEST.json` 覆盖公开源文件；`ASSET-MANIFEST.json` 覆盖 26 项共享运行资源。安装包 SHA-256 随 Release 提供。

可运行的源码检查：

```sh
node apps/tests/combo.test.mjs
node apps/tests/online.test.mjs
node apps/tests/haptics.test.mjs
npm --prefix online-server ci
npm --prefix online-server test
```

---

以下保留 v0.2.0 的历史发行记录，验收结果仅适用于对应版本。

# Air Hockey v0.2.0 原生发行记录

日期：2026-11-05（本机 Asia/Shanghai）。
状态：v0.2.0 已完成本机验收。网页与安装包公开入口：

- 在线玩：<https://zgdllt.github.io/air-hockey-toy/>
- APK / DMG：<https://github.com/zgdllt/air-hockey-toy/releases/tag/v0.2.0>

## 交付范围

同一份二维街机游戏发布为 GitHub Pages 网页、Android APK 与 macOS 通用 DMG。应用包含游戏、用户更新的共享碰撞音效、互动宣传片、原始 30 秒成片及平台图标；不要求玩家安装开发工具。远程联机由其他开发工作单独推进，不包含在这个单机发行包中。

- Android：`apps/android-air-hockey/`，API 26 起，VIBRATE 是唯一申请的权限。HTTPS 本地资源拦截，无 file/content access；没有 INTERNET 权限。优先设备自带 MiHaptic，兼容时使用 Android 波形振动。
- Mac：`apps/mac-air-hockey/`，AppKit / WKWebView，以 WKURLSchemeHandler 读取包内资源；不启动 Python 或 TCP 服务器。arm64 / x86_64 通用构建，部署目标与 Info.plist 均为 macOS 13。
- `web/air-hockey/haptics.mjs` 统一 19 种触感事件、脉冲节奏与强弱参数，两端读取同一份配置；Mac API 只能映射到三种反馈样式，硬件振幅和波形不等同。
- 原生全屏桥接同步窗口 / 系统栏状态与网页布局；系统退出、Android 返回键能恢复正常布局。全屏球桌保持 1000:560 / 560:1000，Canvas 只做等比缩放，指针使用相同的逆变换。
- Android 自适应图标、Mac ICNS；Android 系统窗口保存战绩 PNG，Mac 直接保存至「下载」目录。暂停 / 后台取消待执行触感，恢复通过用户操作进行。

## 修复与审查

- 全屏原先的宽度受 main 最大宽度约束，高度却独立按 viewport 计算，导致宽屏 Mac 上圆形纵向拉伸。现改为根据宽度推导 Canvas 高度，并保留统一缩放作为绘制约束。
- 桌面鼠标无需按住就可以移动球拍；恢复比赛时在用户操作内恢复 AudioContext。
- Toy 云存储启动读取完成前不写入；以启动基线合并云数据，再加本会话的新局数，避免延迟云响应抹掉已经完成的比赛。独立审查夹具验证 5/2 本机、100/70 云数据、延迟期间两胜，得到 102/72，且读取结束前没有写入。
- 已完成独立只读代码审查。触感 19 种配置数据两端一致；等比缩放在 2560×1440、1920×1080、1280×900、390×844、844×390、1000×1800 通过独立布局/坐标检查。

## 运行证据

本地证据在 `.runtime/air-hockey-release-0.2.0/`。接口调用、画面与物理触感分别记录，不把日志当作主观触感验收。

- `web-smoke.json`：浏览器五种桌面 / 竖屏 / 横屏尺寸，开始、输入、暂停 / 恢复、浏览器与原生布局切换、第五个进球、结果卡及宣传片播放通过，无 pageerror。X/Y 绘制缩放相同。
- `android-smoke.json`、`android-haptics.log`：小米 23117RK66C / API 36，原生全屏、Back 退出、触控、19 种 MiHaptic 调用、MP4 readyState=4 且 currentTime 前进，无 pageerror。系统创建文档窗口写出了 PNG，已取回并验证签名和尺寸。测试后按普通方式重开，关闭显式 WebView 调试。
- Android APK 中 ASSET-MANIFEST 的 18 个资源与当前源码逐一核对；不含 SDK jar、keystore、class 或宣传片 stills。
- Mac DMG 挂载、复制 App、卸载磁盘后运行；游戏、全屏、等比缩放、互动宣传片和 MP4 实际播放均已验证。最终 `mac-final-evidence.json` 记录 passed=true：从 DMG 复制后的 App 启动正常，X/Y 缩放均为 2.927957589285714，MP4 readyState=4 且 currentTime 前进，下载目录实际写出 30,004 字节 PNG；诊断已取回证据并只移除自己创建的测试 PNG。

## 发行限制

Mac 使用 ad-hoc 封装签名，没有 Apple Developer ID 签名或公证，互联网下载后的首次打开可能需要在「系统设置 → 隐私与安全性」确认「仍要打开」。Apple Silicon 为本次实测平台；Intel 与 macOS 13 是编译目标，未在对应硬件 / 系统上验证。Android 仅对当前连接的小米设备做实机验证，其他设备使用能力兼容分支。触感设备和系统设置会影响实际感受。

签名密钥留在用户私有目录，保留现有 Android 证书以支持升级。所有公开源文件使用明确 allowlist，同步到独立 GitHub Pages checkout；不把混合工作区整体提交。

最终 APK 已通过 ADB 覆盖安装；设备内 base.apk 与发布候选 SHA-256 完全相同。两个安装包校验值随 GitHub Release 提供。
