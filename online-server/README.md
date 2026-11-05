# Air Hockey · CloudBase WebSocket 房间服

使用 `ws` 提供 `/ws`，同时提供 `/healthz`。`2026-11-05` 已部署为 CloudBase 服务 `air-hockey-rooms`，供浏览器 / Toy / 原生壳复用；微信客户端适配器仍在独立开发，不能把浏览器实测当作微信实测。

公网地址：`wss://air-hockey-rooms-342217-13-1526037855.sh.run.tcloudbase.com/ws`，健康检查为同域 `/healthz`。部署采用 Trial，0.25 vCPU / 0.5 GB，最少 0、最多 1 实例；没有升级套餐。实例运行、构建与流量可能产生用量费用，试用额度抵扣以平台为准。

## 本地运行

```sh
npm install
npm start
```

健康检查：`http://127.0.0.1:8080/healthz`。WebSocket 地址：`ws://127.0.0.1:8080/ws`。微信真机必须使用公网 `wss://` 地址，并在小游戏后台配置合法 Socket 域名；本地开发工具可以按微信开发者工具的网络校验选项调试，不能把这个例外当成上线配置。

## 协议

- `hello` → `hello.ok`
- `room.create` / `room.join` → `room.joined`、`room.state`
- `player.ready` → 两名玩家都准备后 `match.start`
- `input`：玩家只发送目标球拍位置和递增 `seq`
- `player.active`：后台为 false，双方共同暂停；回来手动恢复为 true 后继续
- 服务端固定 tick 推进物理，广播 `snapshot`
- `room.peer_left`、`event.goal`、`match.finish` 等事件用于 UI 和重连处理

## 当前边界与验证

好友房间是匿名邀请场，没有使用未经验证的 `hello.session` 充当账户鉴权，不关联 B站身份或好友场排行榜。微信账号匹配、短期登录票据校验、断线恢复原对局和观战尚未实现，不以此服务宣称账户级防作弊对战。

服务使用内存房间，必须保持最多 1 实例；重启会丢失房间。常规离开立即释放席位，剩余玩家回到等待状态；有 ping/pong 心跳、输入序列拒旧、16 KiB 消息上限和 128 KiB 发送队列保护。终局发送完整快照，双方重新准备可重开。

`node --test server.test.mjs` 验证服务端权威分数、终局、共同暂停、重开、补位和重复创建不泄漏房间。公网两条独立 WSS 连接已实际击球、进球并核对相同快照，两个真实 Toy iframe 上下文也已开局并验证断线提示。证据见 `.runtime/air-hockey-social-0.3.0/`。当前未验证两名真人跨地域网络条件下的手感，也不把原生 API 调用当作物理触感验收。
