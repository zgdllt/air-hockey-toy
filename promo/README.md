# 一拍即合 · 碰撞 — 宣传片

30 秒、1920×1080、60 fps 的宣传片，主题“碰撞”。画面完全由代码逐帧生成，不依赖外部运行时。

成片：`dist/air-hockey-collision-promo.mp4`（另有 `dist/soundtrack.wav`、碰撞事件表 `dist/events.json`、音效 A/B 对比 `dist/sfx-ab.wav`）。

## 数据来源

回合不是手绘动画：`rally.mjs` 用种子随机数（seed 449）驱动游戏自带的 `../physics.mjs`，蓝方由镜像电脑 AI 的机器人操控。画面中的 12 次击球、16 次反弹、擦柱进球、速度和入射/反射角都来自这次实算。3D 视角和时间轴雕塑是同一组数据的可视化。慢放、定格和快放在画面右上角都有标注。

## 分镜

| 时间 | 镜头 |
|---|---|
| 0–3.4 s | “碰”“撞”两字相撞，弹出的冰球拖着轨迹，用圆形转场进入球桌 |
| 3.4–11 s | 2D 俯视：轨迹按最后击球方着色，标出编号碰撞点和速度标签，击球瞬间慢放 |
| 11–14 s | 2D → 3D：俯视镜头倾斜、加推拉变焦，护栏升起，显示预判虚线 |
| 14–17.8 s | 3D：连续反弹，每次标注实测入射角 / 反射角 |
| 17.8–19.8 s | 满速一击：镜头甩到冰球身后，低机位跟拍直到擦柱入网 |
| 19.8–20.6 s | 子弹时间：画面定格，镜头环绕冰球，出现“进！” |
| 20.6–25.6 s | 时间轴：轨迹按时间抬升成立体雕塑，随后压回 2D |
| 25.6–30 s | 结尾卡：只保留制胜一击的轨迹 |

## 预览与重新渲染

```sh
# 在 web/air-hockey/ 下
python3 -m http.server 8123        # 打开 http://localhost:8123/promo/ ，空格播放，←/→ 逐帧
npm install --prefix /tmp/promo-tools playwright-core
export PLAYWRIGHT_CORE=/tmp/promo-tools/node_modules/playwright-core
node promo/record.mjs stills 4.4 12 17.9   # 导出指定时刻静帧
node promo/record.mjs video                # 导出 MP4（约 2 分钟，需 ffmpeg）
node promo/record.mjs sfx                  # 导出新旧音效 A/B 对比 + 电平表
```

## 文件

- `timeline.mjs`：碰撞去重、慢放时间映射、镜头曲线（含跟拍和子弹时间）
- `scene.mjs` / `camera3d.mjs`：球桌、轨迹、碰撞特效；透视相机带近平面裁剪
- `overlay.mjs`：标题、字幕、HUD、结尾卡
- `audio.mjs`：离线配乐；碰撞音效与游戏共用 `../sfx.mjs`
