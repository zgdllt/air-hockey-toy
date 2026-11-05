# 一拍即合 · Android / HyperOS App

复用同一份网页游戏，安装 APK 后离线可玩。最新游戏音效、互动宣传片、30 秒 MP4 和自适应图标均在包内，不需要外部服务器。最低 Android 8 / API 26，本次连接的小米 23117RK66C / HyperOS / API 36 用于实机检查。

## 全屏与触感

球桌 ⛶ 调用原生 WindowInsetsController 隐藏系统栏，同时通知网页切换沉浸布局。再次点击 × 或系统返回可退出。竖屏和横屏保持球桌比例，切到后台暂停，返回手动继续。

`haptics.mjs` 为 Mac / Android 共享的 20 种事件与脉冲表，覆盖双方击球与重击、连续好球 combo、侧壁、门柱、得分/失分、发球、胜负、死球、开局、暂停/继续、重开、难度与开关/全屏。

优先反射调用设备内已有的 MiHaptic `android.os.DynamicEffect` / `HapticPlayer`，再尝试 `miui.os` 命名空间；按共享表设置 transient 时间、intensity、sharpness。兼容接口不可用时使用 Android VibrationEffect 的节奏和振幅。应用不会修改用户的系统触感设置；接口调用记录与主观触感体验应分别判断。

使用受限的 HTTPS 本地资源拦截加载 ES modules，关闭 WebView file/content access。`0.3.0` 在原 VIBRATE 权限外增加 INTERNET，用于公网 WSS 好友对战；单机仍可离线运行。外部链接交给系统浏览器。战绩图通过系统「创建文档」窗口保存，无需全盘存储权限。Toy 连击榜需要在 B站正式 Toy 页面使用，独立 App 不借用浏览器登录身份。

`0.4.0` 增加关联 B站私有云档后的 Elo 匹配和分榜。点击「关联 B站云档」生成设备码，App 在前台打开固定的官方 Toy 页面；在 B站完成登录并批准后返回 App 即可使用同一赛号对战。游戏凭证由一次性授权领取，不读取 B站登录令牌。正式关联入口依赖对应 Toy 更新上线。两端共用 20 类触感事件，对手击球也调用原生引擎。本版本已在重新连接并解锁的小米实机验证 20 类 MiHaptic、实际公网排位对手击球 MiHaptic、全屏等比、返回与 MP4；诊断 authorizer 不是实际 B站登录，API 调用也不能代替主观触感验收。

## 构建与安装

在仓库根运行：

```sh
apps/android-air-hockey/build.sh
adb install -r apps/android-air-hockey/build/air-hockey-android.apk
adb shell am start -n com.zgdllt.airhockey/.MainActivity
```

构建使用 Android SDK android-36.1 / build-tools 37.0.0 和 Java 11，版本来自 `apps/version.json`。每次只暂存明确列出的运行资源，避免旧 stills、SDK jar、密钥和中间产物进入 APK。

签名密钥默认保存在用户私有目录 `~/.local/share/air-hockey/signing/`；不会上传。已有本机测试包的证书被保留以支持覆盖升级。首次安装在新机器时会生成自己的签名，请妥善备份。更换签名不能覆盖已有安装。

## 显式 ADB 诊断

```sh
adb shell am force-stop com.zgdllt.airhockey
adb shell am start -n com.zgdllt.airhockey/.MainActivity --ez diagnostics true
adb logcat -s AirHockeyHaptics:D
```

仅通过该显式参数开启 WebView 调试，普通启动默认关闭。诊断后强制停止并按普通方式重开。日志包含事件种类、脉冲数和最终调用的 MiHaptic / Android 引擎；这不等同于实测所有设备的马达强度。
