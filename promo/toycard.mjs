// Closing Toy segment (TOY_START → DURATION): the end-card rink shrinks into a
// Toy-square tile while the left column follows the voice-over beat by beat.
// Beat times come from word timestamps of assets/voiceover-toy.wav (see voice/README.md).
import { rgba, clamp, smooth, easeOut, easeInOut, mix } from './camera3d.mjs';
import { C, MONO } from './scene.mjs';
import { SERIF } from './overlay.mjs';
import { TOY_START, VO_START } from './timeline.mjs';
import { TOY_SLUG } from './toy.mjs';

const W = 1920;
const PINK = '#fb7299';
const SANS = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
/** Rink size on screen: end card fit (1750) → tile fit (2500), see lookAt(). */
const FIT_FROM = 1750, FIT_TO = 2500;

/** Burned-in subtitles, seconds after VO_START (ASR word timestamps, rounded). */
export const VO_LINES = [
  { t0: 0.0, t1: 2.7, text: '一拍即合，现已登陆 B站 Toy！' },
  { t0: 3.04, t1: 4.8, text: '点视频下方的链接' },
  { t0: 4.84, t1: 6.8, text: '或者在 B站搜索「Toy」' },
  { t0: 7.08, t1: 8.6, text: '打开就能开拍！' },
];
/** Absolute video times of the on-screen beats. */
export const BEATS = { headline: 30.4, onToy: 31.25, step1: 33.44, step2: 35.24, typeFrom: 36.7, typeTo: 37.04, link: 37.48, play: 38.46 };

/** 0 → 1 across the end card → Toy tile transition. */
export const toyMorph = (t) => easeInOut((t - TOY_START) / .9);

/** Pull the end-card camera back and up so the rink fits inside the tile. */
export function toyLook(look, t) {
  const k = toyMorph(t);
  if (k <= 0) return look;
  const cam = { ...look.cam, distance: look.cam.distance * mix(1, FIT_TO / FIT_FROM, k),
    offsetX: mix(look.cam.offsetX, 400, k), offsetY: mix(look.cam.offsetY, -96, k) };
  return { ...look, cam, dark: Math.max(look.dark, smooth((t - TOY_START) / .35)) };
}

/** Tile rectangle around the projected rink corners (a, b = projected (0,0) and (1000,560)). */
function tileRect(a, b) {
  const pad = 22;
  return { x: a.x - pad, y: a.y - pad, w: b.x - a.x + pad * 2, h: b.y - a.y + pad * 2 + 168 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Tile body, drawn under the rink. */
export function drawToyTileBack(ctx, t, cam) {
  const k = toyMorph(t), a = cam.project(0, 0), b = cam.project(1000, 560);
  if (k <= 0 || !a || !b) return;
  const r = tileRect(a, b);
  ctx.save(); ctx.globalAlpha = smooth((k - .25) / .6);
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 18;
  roundRect(ctx, r.x, r.y, r.w, r.h, 26); ctx.fillStyle = C.paper; ctx.fill();
  ctx.restore();
}

/** Tile caption strip and badges, drawn over the rink. */
export function drawToyTileFront(ctx, t, cam) {
  const k = toyMorph(t), a = cam.project(0, 0), b = cam.project(1000, 560);
  if (k <= 0 || !a || !b) return;
  const r = tileRect(a, b), y0 = b.y + 22;
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.globalAlpha = smooth((t - TOY_START - .45) / .5);
  ctx.fillStyle = PINK; roundRect(ctx, r.x + 18, r.y + 18, 92, 40, 20); ctx.fill();
  ctx.font = `700 22px ${MONO}`; ctx.fillStyle = '#fff'; ctx.fillText('Toy', r.x + 43, r.y + 46);
  ctx.font = `900 46px ${SERIF}`; ctx.fillStyle = C.ink; ctx.fillText('一拍即合 · 空气曲棍球', r.x + 30, y0 + 66);
  ctx.font = `500 20px ${MONO}`; let x = r.x + 30;
  for (const chip of ['网页小游戏', '物理对战', '先得 5 分']) {
    const w = ctx.measureText(chip).width + 30; ctx.strokeStyle = rgba(C.ink, .55); ctx.lineWidth = 2;
    roundRect(ctx, x, y0 + 92, w, 40, 20); ctx.stroke(); ctx.fillStyle = C.tealDark; ctx.fillText(chip, x + 15, y0 + 119); x += w + 12;
  }
  // Play button: appears with the link, pops on "开拍".
  const show = easeOut((t - BEATS.link) / .35);
  if (show > 0) {
    const pop = 1 + .14 * Math.exp(-Math.max(0, t - BEATS.play) * 7) * (t > BEATS.play ? 1 : 0);
    const bw = 150, bh = 52, bx = r.x + r.w - bw - 30, by = y0 + 86;
    ctx.globalAlpha = show; ctx.translate(bx + bw / 2, by + bh / 2); ctx.scale(pop * show, pop * show);
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 26); ctx.fillStyle = PINK; ctx.fill();
    ctx.font = `900 26px ${SERIF}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('▶ 开拍', 0, 9);
  }
  ctx.restore();
}

/** Left column: headline, two ways in, the link; plus subtitles and the AI-voice note. */
export function drawToyText(ctx, t) {
  const k = (d, len = .5) => easeInOut((t - d) / len);
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.globalAlpha = k(BEATS.headline - .1); ctx.font = `600 22px ${MONO}`; ctx.fillStyle = PINK;
  ctx.fillText('BILIBILI TOY  ·  打开即玩', 110, 236);
  ctx.globalAlpha = 1; ctx.save(); ctx.beginPath(); ctx.rect(100, 250, 760 * k(BEATS.headline), 200); ctx.clip();
  ctx.font = `900 150px ${SERIF}`; ctx.fillStyle = C.paper; ctx.fillText('一拍即合', 102, 412); ctx.restore();
  ctx.globalAlpha = k(BEATS.onToy); ctx.font = `900 70px ${SERIF}`; ctx.fillStyle = C.paper;
  ctx.fillText('现已登陆', 110, 520); const w0 = ctx.measureText('现已登陆 ').width;
  ctx.fillStyle = PINK; ctx.fillText('B站 Toy', 110 + w0, 520);
  const u = k(BEATS.onToy + .9, .6);
  if (u > 0) {
    const ux = 110 + w0, len = ctx.measureText('B站 Toy').width * u;
    ctx.strokeStyle = C.coral; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(ux, 548); ctx.quadraticCurveTo(ux + len * .45, 534, ux + len, 544); ctx.stroke();
  }
  step(ctx, t, BEATS.step1, 640, '1', (x) => {
    ctx.font = `700 40px ${SERIF}`; ctx.fillStyle = C.paper; ctx.fillText('点视频下方的 Toy 链接', x, 652);
    const bob = Math.sin((t - BEATS.step1) * 7) * 6, ax = x + ctx.measureText('点视频下方的 Toy 链接').width + 34;
    ctx.fillStyle = PINK; ctx.fillText('↓', ax, 652 + bob);
  });
  step(ctx, t, BEATS.step2, 742, '2', (x) => {
    ctx.font = `700 40px ${SERIF}`; ctx.fillStyle = C.paper; ctx.fillText('B站搜索', x, 754);
    searchBox(ctx, t, x + ctx.measureText('B站搜索').width + 22, 712);
  });
  ctx.globalAlpha = k(BEATS.link, .45);
  ctx.font = `600 27px ${MONO}`; ctx.fillStyle = TOY_SLUG ? C.mint : C.coral;
  ctx.fillText(TOY_SLUG ? `www.bilibili.com/toy/${TOY_SLUG}/index.html` : 'www.bilibili.com/toy/‹未设置 TOY_SLUG›/index.html', 110, 872);
  ctx.font = `500 20px ${MONO}`; ctx.fillStyle = rgba(C.paper, .7); ctx.fillText('浏览器即开即玩 · 鼠标 / 触屏 / WASD', 110, 912);
  ctx.globalAlpha = smooth((t - TOY_START - .6) / .5) * .62; ctx.font = `500 15px ${MONO}`; ctx.fillStyle = C.paper;
  ctx.fillText('配音为 AI 语音合成（fish-speech S2-Pro）；参考音色同样由 AI 生成（MiniMax H3），非真人录音。', 110, 1052);
  ctx.restore();
  subtitles(ctx, t);
}

/** Numbered row that slides in at `at`. */
function step(ctx, t, at, y, n, body) {
  const a = easeOut((t - at) / .4);
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate((1 - a) * -30, 0);
  ctx.beginPath(); ctx.arc(134, y, 24, 0, Math.PI * 2); ctx.fillStyle = PINK; ctx.fill();
  ctx.font = `700 26px ${MONO}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(n, 134, y + 9);
  ctx.textAlign = 'left'; body(178);
  ctx.restore();
}

/** Generic rounded search field that types "Toy" in time with the voice. */
function searchBox(ctx, t, x, y) {
  const w = 330, h = 60, typed = 'Toy'.slice(0, Math.round(clamp((t - BEATS.typeFrom) / (BEATS.typeTo - BEATS.typeFrom), 0, 1) * 3));
  roundRect(ctx, x, y, w, h, 30); ctx.fillStyle = rgba(C.paper, .1); ctx.fill(); ctx.strokeStyle = rgba(C.paper, .6); ctx.lineWidth = 2; ctx.stroke();
  ctx.font = `600 30px ${MONO}`; ctx.fillStyle = C.paper; ctx.fillText(typed, x + 28, y + 41);
  const cx = x + 28 + ctx.measureText(typed).width + 4;
  if (Math.floor(t * 2.4) % 2 === 0) { ctx.fillStyle = PINK; ctx.fillRect(cx, y + 15, 3, 32); }
  ctx.strokeStyle = C.paper; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + w - 42, y + 27, 11, 0, Math.PI * 2);
  ctx.moveTo(x + w - 34, y + 35); ctx.lineTo(x + w - 25, y + 44); ctx.stroke();
  const after = smooth((t - BEATS.typeTo - .1) / .4);
  if (after > 0) { ctx.globalAlpha *= after; ctx.font = `500 22px ${MONO}`; ctx.fillStyle = C.mint; ctx.fillText('→ Toy 广场', x + w + 22, y + 39); }
}

function subtitles(ctx, t) {
  const rel = t - VO_START, line = VO_LINES.find((l) => rel >= l.t0 && rel < l.t1);
  if (!line) return;
  const a = Math.min(smooth((rel - line.t0) / .12), smooth((line.t1 - rel) / .12));
  ctx.save(); ctx.globalAlpha = a; ctx.font = `600 38px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(5,14,17,.85)'; ctx.strokeText(line.text, W / 2, 1006);
  ctx.fillStyle = C.paper; ctx.fillText(line.text, W / 2, 1006);
  ctx.restore();
}

/** Fade factor for the old end card as the Toy segment takes over. */
export const endCardFade = (t) => 1 - smooth((t - (TOY_START - .2)) / .4);
