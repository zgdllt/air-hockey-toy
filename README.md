# 一拍即合 · Air Hockey

一个可以直接打开的静态空气曲棍球 Toy：鼠标、触屏或 WASD 控制蓝色球拍，与电脑进行先得 5 分的短局对战。

在线试玩：<https://zgdllt.github.io/air-hockey-toy/>
Android APK / macOS DMG：<https://github.com/zgdllt/air-hockey-toy/releases/latest>

## 本地预览

```sh
python3 -m http.server 8123
```

然后打开 <http://localhost:8123/>。独立的 `air-hockey-toy` 仓库从根目录启动；在 sim2sim 工作区中从 `web/air-hockey/` 启动。ES modules 和资源都使用相对路径。

## 操作

- 桌面端：移动鼠标控制蓝色球拍；也可使用 WASD / 方向键。
- 移动端：按住球桌拖动球拍；竖屏时球桌会自动变成上下布局，你在底部、电脑在顶部。
- 球拍采用快速跟手的街机输入，光标大幅移动时约 60–80 ms 内追上；击球冲量另行限幅，避免鼠标瞬移变成无穷强的球。
- 空格键或右上角按钮暂停 / 继续。
- 球桌右上角的 `⛶` 进入全屏；按 `Esc` 或系统返回退出。全屏会隐藏介绍栏和页脚，只保留比分、操作按钮和球桌。球桌始终等比缩放：横屏 1000:560，竖屏 560:1000，球拍和中圈保持圆形。
- 先得 5 分获胜；结算后可以保存战绩图。

## 技术边界

碰撞音效在 `sfx.mjs`。它用纯 Web Audio 合成，分为瞬态、塑料共振、低频冲击三层，音量、音高和时长随击球速度变化，声像随碰撞位置左右移动。墙壁、门柱、击球各有不同音色，游戏和宣传片共用这一套。宣传片见 [`promo/`](promo/README.md)。

`physics.mjs` 是独立的二维街机物理模型，服务于 Toy 的低门槛游玩体验；它没有把 MuJoCo 或 PiPER-X 机械臂策略编译进浏览器。页面不依赖外部运行时，资源全部使用相对路径，因此可以作为 GitHub Pages 或 Bilibili Toy 静态包。

在 Bilibili Toy 容器里，如果平台注入 `window.toy`，结算时会把本机战绩批量写入 Toy 云存储；在 GitHub Pages 或普通浏览器中自动退回 `localStorage`。云存储只在启动读取一次、结算写入一次，不参与逐帧物理同步。

当前版本是单机对战。Toy 官方 SDK 已验证有云存储、共享存储、排行榜和分享能力，但没有供网页直接使用的实时房间或 WebSocket API；共享存储适合存档或低频共享状态，不足以承载空气曲棍球的逐帧对战。真正的远程 1v1 需要额外的 WebRTC 信令 / 中继服务，另行设计和部署。

## 原生应用

`apps/android-air-hockey/` 和 `apps/mac-air-hockey/` 使用同一套游戏资源。两个安装包内置最新音效、互动宣传片与 MP4，安装后离线可玩；Mac 不依赖 Python 或本地开发服务器。原生按钮负责系统全屏，再同步网页布局。

`haptics.mjs` 统一 19 种事件和节奏，包含双方击球/重击、门柱/侧壁、进球/失分、发球、胜负和比赛控制。Android 优先 MiHaptic、兼容时使用 VibrationEffect；Mac 通过 NSHapticFeedbackManager 映射。设备的触感能力不同，统一事件并不意味着物理振幅相同。应用暂停或关闭触感时取消待执行效果。

Mac 发布包为 Apple Silicon / Intel 通用 DMG，最低部署目标 macOS 13；本次实机验证为 Apple Silicon。当前未做 Apple Developer ID 签名和公证，首次下载打开可能需要按「系统设置 → 隐私与安全性 → 仍要打开」确认。Android 最低 API 26，需要允许安装下载的 APK。具体构建与验证方法见各 App 的 README。
