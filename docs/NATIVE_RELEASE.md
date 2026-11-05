# Air Hockey 原生发行记录

日期：2026-11-05（本机 Asia/Shanghai）。
本记录覆盖当前版本 v0.4.1 / code 6，正式 Toy 已更新并完成真实 B站私有云档 → 小米 App 关联；Android 授权优先在 B站 App 打开。本机 Mac 和小米均已升级，详情以排行榜与排位记录为准。下文较旧版本按各自当时范围保留。

v0.4.0 / code 5 的云档关联、分榜与排位候选已构建并安装；27 项运行资源、APK 签名及 DMG 挂载读回通过。Mac 原生排位 / 安装版复测，以及重新连接的小米实机 MiHaptic / 排位 / 全屏复测通过。Toy 最终预览验收通过、已由用户确认提交并通过审核上线；GitHub v0.4.0 网页和预发布安装包已公开并回读验证。当前状态与证据以 [排行榜与排位记录](LADDER.md) 为准。

网页与安装包公开入口：

- 在线玩：<https://zgdllt.github.io/air-hockey-toy/>
- APK / DMG：<https://github.com/zgdllt/air-hockey-toy/releases/tag/v0.4.1>

## v0.2.0 单机发行范围（历史）

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

公开网页最终验收已完成：部署任务 `41879973767` 成功，`pages-continuation.json` 为 `verified`，公开 index / game / styles / physics / sfx / haptics / film 共 7 个文件哈希匹配源码。1987×1248 桌面和 390×844 竖屏公开页面的开局、暂停、全屏等比缩放及成片元数据检查通过。原先 Actions 队列等待已经解除，网页、APK 和 DMG 三项发布均完成。

## v0.2.1 发布前 Combo 优化（本地已验证）

当前构建版本为 0.2.1 / code 3。增加顶部 combo 横幅、星星动效、随连击升高的实际碰撞音高及第 20 种共享触感事件。实现与 Toy 预览细节见 [Toy 交付记录](https://www.bilibili.com/toy/yi-pai-ji-he-air-hockey/index.html)。本次未把 v0.2.1 发布到 GitHub Release，已有 v0.2.0 发布记录仍为上文所述版本。

两端重建并验证 22 项源码 / Mac 包 / APK 运行资源的 SHA-256 一致；补齐互动宣传片依赖与配音 WAV。Mac 通用二进制与封装签名通过，原生 smoke 检查游戏启动、全屏等比缩放与退出、全部触感接口、互动宣传片、30 秒 MP4 播放和战绩 PNG 写入，`passed=true`。音频回归另行实际渲染了含配音的 39 秒互动宣传片音轨，未重写现有 MP4。

本机 `/Applications/AirHockey.app` 已覆盖为最终候选，包内 22 项资源逐一核对；连接的小米 23117RK66C 已覆盖安装并按普通方式启动，设备 `base.apk` 哈希与最终候选相同。主观音色和新增 combo 物理触感仍待用户试玩，不以桥接日志代替主观验收。独立只读代码审查、计数单测、20 类触感桥接单测和浏览器完整事件序列均通过。

本次证据在 `.runtime/air-hockey-combo-0.2.1/`，包括 `browser-check.json`、`remote-check.json`、`mac-smoke/mac-smoke.json`、`android-install.json`、`toy-assets.json` 和四次击球试听 `combo-impact-1-2-3-4.wav`。

## v0.3.0 排行榜与公网好友对战（GitHub 已发布）

版本为 0.3.0 / code 4。单机离线可玩，好友对战连接已部署的 CloudBase WSS 服务；排行榜依赖正式 B站 Toy 的账号上下文，原生 App 与普通站点会展示入口说明。玩法、部署配置与 Toy 预览状态见 [Toy 交付记录](https://www.bilibili.com/toy/yi-pai-ji-he-air-hockey/index.html)。Android 新增 INTERNET 权限以连接 WSS；VIBRATE 继续用于触感。

Mac / APK 的 26 项运行资源 SHA-256 相同，Toy 包在 `.mjs` → `.js` 转换后逐项匹配。最终打包后另有并行工作将宣传片 `promo/rally.mjs` 的 `makeBlueBot` 改为导出函数；该后续源码改动未混入本次冻结候选，未回退。其余源码与候选匹配，详情见 `mac-install.json` 的 `sourceChangesSinceFreeze`。

- Mac：通用 arm64 / x86_64，封装签名验证通过。`mac-online-final/mac-smoke.json` 为 passed=true，实际 WKWebView 创建公网房间并与第二个独立连接进入比赛；原生全屏与退出、X/Y 等比缩放、互动宣传片、MP4 时间前进、战绩 PNG 实际写入通过。此证据来自构建目录 App，不表示两位真人或物理触感已验收。
- DMG：以只读方式挂载，核对版本、通用架构、封装签名、图标、可执行文件与 26 项资源，均与已验证构建一致，已卸载磁盘。`dmg-verify.json` 为 passed=true。
- 本机 `/Applications/AirHockey.app` 已覆盖为 0.3.0 / code 4；签名、二进制、图标与 26 项资源逐一核对通过。保留 `/Applications/触感对照.app`。安装后的复测能进入公网比赛、播放 MP4、写出 PNG，但 Mac 系统锁屏使首次绘制与全屏断言失败，失败结果保留在 `mac-installed-final/` 和 `mac-installed-launchservices/`，解锁后已在 `mac-installed-unlocked/` 复测通过，未覆盖此前失败记录。
- Android：签名 APK 已构建，运行资源与 Mac 一致。ADB 未连接，用户明确选择“先验证网页和 Mac”，因此本次未声称已覆盖安装或完成小米实机联机、触控、触感验收。
- 20 类触感配置与桥接回归通过；没有用自动调用结果代替主观触感强度验收。当前 Mac 仍为 ad-hoc 签名、未公证，首次下载限制与前述相同。

产物与校验值：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `apps/mac-air-hockey/build/air-hockey-macos-universal.dmg` | 22,786,869 B | `7046f598f73cfb60cbe0b044d94ecea802008252c1b960a5301a0765fb917dee` |
| `apps/android-air-hockey/build/air-hockey-android.apk` | 22,514,041 B | `6abc490f970cf2f8201c0f49692a67f01da04a1ed256d8e4e3778eb770c4fb3b` |

证据保存在 `.runtime/air-hockey-social-0.3.0/`，包括 `artifact-hashes.json`、`mac-install.json`、`dmg-verify.json`。本机 App 已按普通方式启动；解锁后的安装版复测 `mac-installed-unlocked/mac-smoke.json` 为 passed=true，原生全屏 / 退出、等比缩放、视频、PNG 保存及公网房间开赛通过；此前锁屏失败证据仍保留。本次 Toy 更新审核尚未提交，等待最终预览的明确确认。

GitHub v0.3.0 已正式发布：main 与 tag 均为 `cee686bc76b4822b3db7c3cfe344bbd6f5c07f39`；Pages 工作流 `42013961996` 为 success。公开网页 26 项运行资源逐项哈希一致，桌面与 390×844 竖屏单机、全屏等比缩放、两个公开客户端的公网房间对局与离开通过，无脚本错误。Release 的 DMG、APK 与 SHA256SUMS 已重新下载，校验值均与上述候选一致；结果见 `github-publication.json`、`github-pages-hashes.json`、`github-browser-test.json`。公开源码经过独立白名单 / 私密文件审查，61 个源文件加一份 SOURCE-MANIFEST，未同步本机密钥、设备 SDK jar、构建目录或其他项目。
