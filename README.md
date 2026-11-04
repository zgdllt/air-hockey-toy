# 一拍即合 · Air Hockey

一个可以直接打开的静态空气曲棍球 Toy：鼠标、触屏或 WASD 控制蓝色球拍，与电脑进行先得 5 分的短局对战。

在线试玩：<https://zgdllt.github.io/air-hockey-toy/>

## 本地预览

```sh
python3 -m http.server 8123
```

然后打开 <http://localhost:8123/>。需要从 `web/air-hockey/` 目录启动静态服务器，因为 ES module 和相对资源路径都按这个目录组织。

## 操作

- 桌面端：移动鼠标控制蓝色球拍；也可使用 WASD / 方向键。
- 移动端：按住球桌拖动球拍；竖屏时球桌会自动变成上下布局，你在底部、电脑在顶部。
- 空格键或右上角按钮暂停 / 继续。
- 先得 5 分获胜；结算后可以保存战绩图。

## 技术边界

`physics.mjs` 是独立的二维街机物理模型，服务于 Toy 的低门槛游玩体验；它没有把 MuJoCo 或 PiPER-X 机械臂策略编译进浏览器。页面不依赖外部运行时，资源全部使用相对路径，因此可以作为 GitHub Pages 或 Bilibili Toy 静态包。

在 Bilibili Toy 容器里，如果平台注入 `window.toy`，结算时会把本机战绩批量写入 Toy 云存储；在 GitHub Pages 或普通浏览器中自动退回 `localStorage`。云存储只在启动读取一次、结算写入一次，不参与逐帧物理同步。

当前版本是单机对战。Toy 官方 SDK 已验证有云存储、共享存储、排行榜和分享能力，但没有供网页直接使用的实时房间或 WebSocket API；共享存储适合存档或低频共享状态，不足以承载空气曲棍球的逐帧对战。真正的远程 1v1 需要额外的 WebRTC 信令 / 中继服务，另行设计和部署。
