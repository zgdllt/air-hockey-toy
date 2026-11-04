// Screen-space typography and HUD: title, captions, HUD, goal slam, end card.
import { rgba, clamp, smooth, easeOut, easeInOut, mix } from './camera3d.mjs';
import { C, OWNER, MONO } from './scene.mjs';

export const SERIF = '"Noto Serif SC", "Songti SC", "STSong", serif';
const W = 1920, H = 1080;

export function mixHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(mix((pa >> s) & 255, (pb >> s) & 255, clamp(k, 0, 1)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function drawBackdrop(ctx, dark) {
  ctx.fillStyle = mixHex(C.paper, C.inkDeep, dark); ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.strokeStyle = dark > .5 ? rgba(C.mint, .05) : rgba(C.ink, .055); ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= W; x += 48) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
  for (let y = 0; y <= H; y += 48) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
  ctx.stroke();
  if (dark > .01) {
    const v = ctx.createRadialGradient(W / 2, H / 2, H * .25, W / 2, H / 2, H * .95);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${.45 * dark})`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Puck born from the title collision, bouncing inside the frame; stateless. */
export function titlePuck(t, impact = .95, bounces = null) {
  const pts = [];
  let x = W / 2, y = 470, vx = 1180, vy = -760;
  for (let s = impact; s <= t; s += 1 / 240) {
    x += vx / 240; y += vy / 240;
    let bounced = false;
    if (x < 70 || x > W - 70) { vx = -vx; x = clamp(x, 70, W - 70); bounced = true; }
    if (y < 70 || y > H - 70) { vy = -vy; y = clamp(y, 70, H - 70); bounced = true; }
    if (bounced && bounces) bounces.push(s);
    pts.push([x, y]);
  }
  return pts;
}

/** Video times at which the title puck hits the frame edge (for the soundtrack). */
export function titlePuckBounces(tEnd) { const out = []; titlePuck(tEnd, .95, out); return out; }

export function drawTitle(ctx, t) {
  const impact = .95, cx = W / 2, cy = 470, since = t - impact;
  const approach = clamp(t / impact, 0, 1) ** 2.2;
  const recoil = since > 0 ? Math.sin(since * 15) * Math.exp(-since * 5) * 42 : 0;
  const squash = since > 0 ? 1 - .2 * Math.exp(-since * 11) : 1;
  const shake = since > 0 ? Math.exp(-since * 7) * 16 : 0;
  ctx.save(); ctx.translate(Math.sin(t * 80) * shake, Math.cos(t * 67) * shake * .7);
  const fade = 1 - smooth((t - 2.6) / .6);
  ctx.globalAlpha = fade;
  ctx.font = `900 300px ${SERIF}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const glyph = (ch, x, color, sx) => { ctx.save(); ctx.translate(x, cy); ctx.scale(sx, 1 / Math.sqrt(sx)); ctx.lineWidth = 14; ctx.strokeStyle = C.ink; ctx.lineJoin = 'round'; ctx.strokeText(ch, 0, 0); ctx.fillStyle = color; ctx.fillText(ch, 0, 0); ctx.restore(); };
  if (since > 0) {
    const pts = titlePuck(t, impact);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(cx, cy);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.shadowColor = C.yellow; ctx.shadowBlur = 18; ctx.strokeStyle = C.yellow; ctx.lineWidth = 9; ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
  }
  glyph('碰', mix(-260, cx - 158, approach) - Math.abs(recoil), C.tealLight, squash);
  glyph('撞', mix(W + 260, cx + 158, approach) + Math.abs(recoil), C.coral, squash);
  if (since > 0 && since < .9) {
    const k = since / .9;
    ctx.globalAlpha = (1 - k) * fade; ctx.strokeStyle = C.ink;
    for (const [m, lw] of [[1, 8], [.62, 4]]) { ctx.beginPath(); ctx.arc(cx, cy, 30 + easeOut(k) * 520 * m, 0, Math.PI * 2); ctx.lineWidth = lw; ctx.stroke(); }
    ctx.beginPath();
    for (let i = 0; i < 18; i += 1) { const a = i / 18 * Math.PI * 2 + .2, r0 = 120 + easeOut(k) * 200, r1 = r0 + 60 + (i % 2) * 50; ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
    ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
    if (since < .08) { ctx.globalAlpha = 1 - since / .08; ctx.fillStyle = C.yellow; ctx.beginPath(); ctx.arc(cx, cy, 160, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = fade;
  if (since > 0) {
    const pts = titlePuck(t, impact), head = pts[pts.length - 1] || [cx, cy];
    ctx.beginPath(); ctx.arc(head[0], head[1], 22, 0, Math.PI * 2); ctx.fillStyle = C.yellow; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.ink; ctx.stroke();
  }
  const sub = smooth((t - 1.25) / .5);
  ctx.globalAlpha = sub * fade; ctx.textAlign = 'center';
  ctx.font = `500 30px ${MONO}`; ctx.fillStyle = C.ink; ctx.fillText('C O L L I S I O N', cx, cy + 250 + (1 - sub) * 20);
  ctx.font = `700 34px ${SERIF}`; ctx.fillStyle = C.tealDark; ctx.fillText('一拍即合 · 空气曲棍球', cx, cy + 305 + (1 - sub) * 24);
  ctx.restore();
  ctx.save(); ctx.globalAlpha = smooth(t / .4) * fade; ctx.font = `500 18px ${MONO}`; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
  ctx.fillText('AIR HOCKEY CLUB  /  VOL. 01  —  A SHORT FILM ABOUT IMPACT', 72, 80); ctx.restore();
}

/** Ticket-style caption with clip reveal and a hand-drawn coral underline. */
export function caption(ctx, t, c) {
  const k = (t - c.t0) / .45, out = (c.t1 - t) / .35;
  if (k <= 0 || out <= 0) return;
  const inK = easeOut(k), outK = smooth(out), x = c.x ?? 80, y = c.y ?? 812;
  ctx.save(); ctx.globalAlpha = outK;
  ctx.font = `900 ${c.size || 76}px ${SERIF}`;
  const tw = ctx.measureText(c.zh).width, w = tw + 84, h = (c.size || 76) + 112;
  ctx.beginPath(); ctx.rect(x, y, w * inK, h); ctx.clip();
  ctx.fillStyle = C.paper; ctx.fillRect(x, y, w, h); ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.fillStyle = C.coral; ctx.beginPath(); ctx.arc(x + 46, y + 40, 7, 0, Math.PI * 2); ctx.fill();
  ctx.font = `500 18px ${MONO}`; ctx.fillStyle = C.tealDark; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(c.en, x + 64, y + 41);
  ctx.font = `900 ${c.size || 76}px ${SERIF}`; ctx.fillStyle = C.ink; ctx.fillText(c.zh, x + 42, y + 64 + (c.size || 76) / 2);
  const u = smooth((t - c.t0 - .35) / .5);
  if (u > 0) {
    const ux = x + 40, uy = y + h - 22, len = (tw + 10) * u;
    ctx.strokeStyle = C.coral; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(ux, uy); ctx.quadraticCurveTo(ux + len * .45, uy - 14, ux + len, uy - 4); ctx.stroke();
  }
  ctx.restore();
}

/** Top/bottom HUD with an honest slow-motion badge and a rally progress strip. */
export function drawHud(ctx, film, t, s, look, alpha) {
  if (alpha <= 0) return;
  const ink = mixHex(C.ink, C.paper, look.dark), sub = rgba(look.dark > .5 ? C.mint : C.ink, .62);
  ctx.save(); ctx.globalAlpha = alpha; ctx.textBaseline = 'middle';
  ctx.font = `900 30px ${SERIF}`; ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText('一拍即合', 72, 74);
  ctx.font = `500 14px ${MONO}`; ctx.fillStyle = sub; ctx.fillText('AIR HOCKEY CLUB', 72, 106);
  badge(ctx, t, look.view, 262, 74, ink, look.dark);
  ctx.textAlign = 'right'; ctx.font = `500 16px ${MONO}`; ctx.fillStyle = sub;
  ctx.fillText(`REAL ENGINE RALLY · AI vs AI · SEED ${film.seed}`, W - 72, 64);
  ctx.font = `600 30px ${MONO}`; ctx.fillStyle = ink;
  ctx.fillText(`T+${Math.max(0, s - film.R0).toFixed(3)} s`, W - 72, 102);
  const label = speedLabel(film, t);
  if (label) {
    ctx.font = `600 22px ${MONO}`; const w = ctx.measureText(label.text).width + 30;
    ctx.fillStyle = label.color; ctx.fillRect(W - 72 - w - 300, 84, w, 38); ctx.fillStyle = C.paper; ctx.textAlign = 'left'; ctx.fillText(label.text, W - 72 - w - 285, 104);
  }
  strip(ctx, film, s, ink, sub);
  ctx.restore();
}

/** Honest playback-speed badge: slow motion, freeze frame, or fast replay. */
function speedLabel(film, t) {
  if (t >= 3.4 && t < 20.6) {
    const rate = film.rateAt(t);
    if (rate < .005) return { text: 'FREEZE FRAME', color: C.ink };
    if (rate < .9) return { text: `SLOW-MO × ${rate.toFixed(2)}`, color: C.coral };
  }
  if (t >= 21.6 && t < 24) {
    const rate = film.replayRate(t);
    if (rate > 1.1) return { text: `REPLAY × ${rate.toFixed(1)}`, color: C.tealDark };
  }
  return null;
}

function badge(ctx, t, text, x, y, ink, dark) {
  const flip = t > 11.7 && t < 12.3 ? Math.abs(Math.cos((t - 11.7) / .6 * Math.PI)) : 1;
  ctx.save(); ctx.font = `600 20px ${MONO}`; const w = ctx.measureText(text).width + 34;
  ctx.translate(x + w / 2, y); ctx.scale(1, flip);
  ctx.fillStyle = ink; ctx.fillRect(-w / 2, -20, w, 40); ctx.fillStyle = C.yellow; ctx.fillRect(-w / 2, -20, 6, 40);
  ctx.fillStyle = mixHex(C.paper, C.inkDeep, dark);
  ctx.textAlign = 'center'; ctx.fillText(text, 4, 1); ctx.restore();
}

function strip(ctx, film, s, ink, sub) {
  const x0 = 420, x1 = W - 420, y = 1022, span = film.goal.t - film.start;
  const X = (time) => x0 + (x1 - x0) * clamp((time - film.start) / span, 0, 1);
  ctx.strokeStyle = sub; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(X(s), y); ctx.stroke();
  let hits = 0, bounces = 0;
  for (const e of film.events) {
    const past = e.t <= s, ex = X(e.t);
    if (e.type === 'hit') { if (past) hits += 1; ctx.fillStyle = past ? OWNER[e.side] : sub; ctx.fillRect(ex - 3, y - 20, 6, 20); }
    else if (e.type === 'goal') { ctx.fillStyle = past ? C.coral : sub; ctx.beginPath(); ctx.arc(ex, y, 8, 0, Math.PI * 2); ctx.fill(); }
    else { if (past) bounces += 1; ctx.fillStyle = past ? C.yellow : sub; ctx.fillRect(ex - 2, y + 4, 4, 11); }
  }
  ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(X(s), y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.font = `600 18px ${MONO}`; ctx.textAlign = 'right'; ctx.fillStyle = ink;
  ctx.fillText(`HITS ${String(hits).padStart(2, '0')}  ·  BOUNCES ${String(bounces).padStart(2, '0')}`, x0 - 30, y);
  ctx.textAlign = 'left'; const p = film.sample(s).puck;
  ctx.fillText(`PUCK ${String(Math.round(Math.hypot(p.vx, p.vy))).padStart(4, ' ')} PX/S`, x1 + 30, y);
}

export function drawGoalSlam(ctx, t, t0, subtitle) {
  const k = t - t0;
  if (k < 0 || k > 1.2) return;
  ctx.save();
  if (k < .12) { ctx.globalAlpha = (1 - k / .12) * .8; ctx.fillStyle = C.yellow; ctx.fillRect(0, 0, W, H); }
  const fade = 1 - smooth((k - .85) / .35), sc = mix(1.7, 1, easeOut(k / .22));
  ctx.globalAlpha = fade; ctx.translate(W / 2, H / 2 - 30); ctx.rotate(-.07); ctx.scale(sc, sc);
  ctx.font = `900 360px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 22; ctx.lineJoin = 'round'; ctx.strokeStyle = C.ink; ctx.strokeText('进！', 0, 0);
  ctx.fillStyle = C.coral; ctx.fillText('进！', 0, 0);
  ctx.font = `600 34px ${MONO}`; ctx.fillStyle = C.paper; ctx.fillText(subtitle, 0, 230);
  ctx.restore();
}

/** Labelled time axis standing on the rink corner during the lift shot. */
export function drawTimeAxis(ctx, cam, film, lift, zOf) {
  if (lift < .02) return;
  const base = [-60, -60];
  ctx.save(); ctx.globalAlpha = smooth(lift * 2);
  const a = cam.project(base[0], base[1], 0), b = cam.project(base[0], base[1], zOf(film, lift, film.goal.t) + 40);
  if (!a || !b) { ctx.restore(); return; }
  ctx.strokeStyle = C.paper; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.font = `600 18px ${MONO}`; ctx.fillStyle = C.paper; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let sec = 0; sec <= Math.floor(film.goal.t - film.R0); sec += 1) {
    const p = cam.project(base[0], base[1], zOf(film, lift, film.R0 + sec));
    if (!p) continue;
    ctx.fillRect(p.x - 8, p.y - 1, 16, 2); ctx.fillText(`${sec}s`, p.x - 14, p.y);
  }
  ctx.fillStyle = C.yellow; ctx.fillText('TIME ↑', b.x - 10, b.y - 14);
  ctx.restore();
}

export function drawEndCard(ctx, t, film) {
  const k = (d) => easeInOut((t - d) / .6);
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.globalAlpha = k(26.0); ctx.font = `500 20px ${MONO}`; ctx.fillStyle = C.tealDark;
  ctx.fillText('AIR HOCKEY CLUB  ·  VOL. 01', 110, 300);
  ctx.globalAlpha = 1; ctx.save(); ctx.beginPath(); ctx.rect(100, 300, 760 * k(26.2), 220); ctx.clip();
  ctx.font = `900 172px ${SERIF}`; ctx.fillStyle = C.ink; ctx.fillText('一拍即合', 102, 482); ctx.restore();
  const u = k(26.6);
  if (u > 0) {
    ctx.strokeStyle = C.coral; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(110, 520); ctx.quadraticCurveTo(110 + 330 * u, 488, 110 + 700 * u, 510);
    ctx.moveTo(170, 540); ctx.quadraticCurveTo(170 + 280 * u, 522, 170 + 560 * u, 535); ctx.stroke();
  }
  ctx.globalAlpha = k(26.9); ctx.font = `700 54px ${SERIF}`; ctx.fillStyle = C.ink; ctx.fillText('来点', 110, 632);
  const w1 = ctx.measureText('来点').width; ctx.fillStyle = C.tealDark; ctx.fillText('碰撞', 110 + w1, 632);
  const w2 = ctx.measureText('碰撞').width; ctx.fillStyle = C.coral; ctx.fillText('，一拍就上头。', 110 + w1 + w2, 632);
  ctx.globalAlpha = k(27.3); let x = 110;
  ctx.font = `500 21px ${MONO}`;
  for (const chip of ['鼠标 / 触屏 / WASD', '先得 5 分', '浏览器即开即玩']) {
    const w = ctx.measureText(chip).width + 34; ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x, 680, w, 46);
    ctx.fillStyle = C.ink; ctx.fillText(chip, x + 17, 711); x += w + 14;
  }
  ctx.globalAlpha = k(27.7);
  ctx.fillStyle = C.ink; ctx.fillRect(110, 770, 300, 78); ctx.font = `900 34px ${SERIF}`; ctx.fillStyle = C.paper; ctx.fillText('立即开拍', 140, 821);
  ctx.fillStyle = C.coral; ctx.fillText('↗', 352, 821);
  ctx.font = `600 26px ${MONO}`; ctx.fillStyle = C.tealDark; ctx.fillText('zgdllt.github.io/air-hockey-toy', 436, 820);
  ctx.globalAlpha = k(28.0) * .8; ctx.font = `500 15px ${MONO}`; ctx.fillStyle = C.ink;
  ctx.fillText(`画面为游戏内置 2D 物理引擎实算回合（AI 对 AI，种子 ${film.seed}，${film.hits.length} 次击球 / ${film.bounces.length} 次反弹）；3D 与时间轴是同一组数据的可视化，慢放 / 定格 / 快放均已标注。`, 110, 1010);
  ctx.restore();
}
