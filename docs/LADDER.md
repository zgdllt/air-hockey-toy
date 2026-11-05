# Air Hockey v0.4.0 排行榜与排位

2026-11-05。状态：v0.4.0 / code 5 已实现；真实 PG、公网 WSS、浏览器、Mac 和小米原生实机及包体检查通过。Toy 新预览已生成，尚未提交本次审核；GitHub 发行状态见 [v0.4.0](https://github.com/zgdllt/air-hockey-toy/releases/tag/v0.4.0)。

## 用户确认与范围

- 单人练习和联网排位分别计榜。单人按热身、标准、挑战区分；现有 Toy combo 榜保留。
- 增加最高连胜、当前胜率、胜局数；联网排位另有 Elo 天梯和匹配队列。好友房间不影响排位战绩。
- 用户接受 B站私有云存档保存游戏服务器凭证、CloudBase 保存并结算 Elo。该凭证不等于平台签名的 B站身份证明，不保证一 B站账号只创建一个赛号。
- Toy 内由主动操作读档 / 创建；App 与普通网页通过一次性授权码由 Toy 页面批准关联，不要求独立注册或手动恢复码。服务器仅保存凭证摘要；不记录 Toy OpenID、MID、平台登录令牌。
- 用户随后重新连接 ADB 并解锁小米手机，v0.4.0 实机复测已完成。Mac 与 Android 均已安装新候选；保留 Mac 触感对照工具。

## 统计规则

- 练习新榜从本版本完整结束的比赛开始累计；旧版本机总战绩保留，不推测旧对局难度。练习结果来自客户端，明确不具备排位的服务器权威性，不影响 Elo。
- 连胜榜取所选周期内最高连续胜局，失败清当前连胜；胜率随每局结果升降，至少完成 10 局才参与胜率排名，自己的样本数始终可见。胜局榜按累计胜局排序。
- 新榜支持总 / 日 / 周 / 月统计，时间窗口为 Asia/Shanghai。Elo 为当前积分总榜，不冒充按周期独立赛季。
- 排位初始 1000 分，K=32，按对手积分计算预期胜率，双方加减相同的整数分。只有服务器启动并结算的排位局计分；同一 match ID 重复处理不得重复计分。
- 匹配优先积分接近的玩家，等待后逐步放宽差距；只有真人连接，不以 AI 填充。取消排队不计负；已开始的比赛主动退出判负。断线给 20 秒重连，后台共同暂停最长 60 秒，超时仍未返回的一方判负。
- 容器重启时遗留未结算局作废，不改变 Elo；已落库的战绩和天梯保留。数据库异常时不启动新的排位，不以内存榜冒充持久化。

## 数据与部署边界

复用 `air-hockey-d4gshcp7yd5a37355` 现有 PostgreSQL SHARED，通过官方 SDK / 网关 RPC 访问，不使用 TCP/VPC 或本地登录凭据。服务 `air-hockey-rooms` 仍为 0.25 vCPU / 0.5 GB、0–1 实例；不购买、升级套餐或新增数据库实例。

专用服务 API Key 从 CloudBase 管理 API 签发，只注入运行环境；责任归属本项目维护者，轮换后更新服务环境，撤销使用 keyId 的 deleteApiKey。前端包、源码、健康接口、日志不包含服务密钥、完整请求头或环境变量。

PG 业务表与 RPC 仅授权 service_role，启用 RLS 并撤销 anon / authenticated 的直接访问；浏览器仅访问房间服的受限业务操作。比赛结算事务同时锁定双方数据、写入结果并更新统计。验证数据使用独立 scope，不能混入 live 榜单。

## 对标与取舍

参考 [PlayFab 匹配流程](https://learn.microsoft.com/en-us/xbox/playfab/multiplayer/matchmaking/how-matchmaking-works) 的技能差与等待放宽规则，采用适合当前双人规模的队列；不引入整套 PlayFab 服务。Elo 采用“实际结果减预期结果，再乘 K”的更新原则，可对照 [FIDE 评分规则](https://handbook.fide.com/chapter/B022024)，本游戏的初始分、K 和整数守恒规则是自己的产品选择，不声称遵循 FIDE 赛事规则。

## 完成标准

1. SQL schema / 权限、真实 PG RPC 与重启保留验证通过，测试数据与 live 分离。
2. Elo、连胜 / 胜率 / 胜局、周期、重复结算，以及匹配取消 / 自匹配拒绝 / 断线宽限 / 退出判负有直接验证。
3. 浏览器完整走通 Toy 读档关联、App 授权、分榜、排队和真实服务器对局；Mac 全屏、音效 / 视频等必要回归通过。
4. 独立只读审查、冻结包与资源清单通过后生成新 Toy 预览。用户确认新预览后才提交，不能复用 v0.3.0 的确认。

## 当前验证与交付

- 新预览：<https://www.bilibili.com/toy/preview/author_AxtkQAJL/index.html>。目标仍为作品 `51810219857920`、`yi-pai-ji-he-air-hockey`，封面 / 图标 / 公开可见性保留。正式页面暂为此前已发布的单人版；App 的真实 B站云档关联须待新 Toy 上线后验证，不能把预览或诊断 authorizer 当作真实 B站登录。
- 真实 PG：`pg-integration.json` 通过。9 胜 / 10 局为 90%，再输一局后胜率降低；最高连胜 9 / 当前 0；重复练习成绩和并发排位终局均幂等；新客户端恢复 1016 分；重启恢复遗留局作废，不改积分；live 榜未写测试成绩。
- 服务 version004 已正常发布、100% 流量，沿用 version003 的修补依赖镜像并切到正式 `live` scope；运行资源仍为 0.25 vCPU / 0.5 GB、0–1 实例。公网 `public-competition-test.json` 通过：两个排位客户端进入比赛，主动退出判负，积分 984 / 1016，并实际读回档案和榜单。所有计分测试使用独立 `public_verification_20261105` scope；正式隔离检查见 `live-service-verify.json`。
- 浏览器：`browser-test.json` 通过，练习三类榜、设备关联、同账号自匹配拒绝、两端排位结算、云档重载恢复积分，无页面错误。Toy 身份 API 使用契约夹具；后端为真实 PG + 本地 WebSocket，不声称已验真实 B站账号授权。
- 回归：服务端 6 个测试项（含 8 组异步 / 断线状态回归），客户端 7 组凭证 / 存档 / 幂等回归，好友连接、combo 与 20 类触感桥接通过；修补 SDK 依赖后 `npm audit` 为 0 漏洞。
- 包体：`artifact-verify.json` 通过。27 项运行资源在发布源码、Mac App、APK 中 SHA-256 相同；DMG 只读挂载后包体逐文件一致，通用架构、签名、图标存在。
- Mac：`mac-ranked-final/mac-smoke.json` 与 `companion.json` 通过，实际公网排位中收到对手击球并调用原生 performer（baseline 后 +1），20 类事件均有原生调用；首次绘制、原生全屏等比缩放、退出、互动宣传片 / MP4、下载目录 PNG 写入通过，无 JS 错误。`/Applications` 安装后另以 `mac-installed-final/mac-smoke.json` 复测通过。此前因显示 / 前台不可用、授权后后台超时导致的失败记录保留，没有抹掉或当作成功。
- 小米 23117RK66C / HyperOS / API 36：`android-native/android-smoke.json` 通过，20 类 MiHaptic、实际公网排位对手击球的新 MiHaptic 调用、授权码关联、原生全屏等比 / Canvas 像素、返回退出、MP4 播放均通过，无 JS 错误。恢复测试前的 3 个本地存档键并逐键读回一致；按普通方式重开，调试端口和本次 ADB 转发已关闭。设备 `base.apk` 与最终候选 SHA-256 相同。CDP 截图无法呈现部分 Canvas 合成层，视觉证据另用设备原生 screencap，不用空白 CDP 图证明绘制。
- 发布源位于隔离 checkout `release-source/`，使用明确源码 allowlist。宣传片采用已公开 v0.3.0 的 30 秒 MP4 / 配套资源快照；没有回退或混入工作区另一项正在进行的长版宣传片修改。

以上证据在本机 `.runtime/air-hockey-ladder-0.4.0/`。Mac 的原生 performer 调用与主观触感分别验收；两个客户端公网开局不代表两位真人跨地域的延迟体验已经验证。
