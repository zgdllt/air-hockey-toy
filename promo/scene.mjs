// World-space drawing: rink, rails, bodies, trajectory and collision effects.
import { RINK } from '../physics.mjs';
import { ANGLE_WINDOW } from './timeline.mjs';
import { tracePoints, ring, disc, cylinder, box, rgba, mix, clamp, smooth, easeOut } from './camera3d.mjs';

export const C = { paper: '#f4f3e9', ink: '#162b32', inkDeep: '#0b1c21', tealDark: '#0d5864', tealLight: '#9ce5d9',
  coral: '#ef765c', yellow: '#f2bd45', mint: '#b4f4e7' };
export const OWNER = { player: '#7ff3e0', computer: '#ff8a6e', serve: '#f2bd45' };
const LIFT_HEIGHT = 380;
export const MONO = '"DM Mono", "SF Mono", Menlo, monospace';

/** Height of the time-axis sculpture at a sim time. */
export function zOf(film, lift, simT) {
  return lift * clamp((simT - film.start) / (film.goal.t - film.start), 0, 1) * LIFT_HEIGHT;
}

export function drawRink(ctx, cam, dim) {
  if (dim > 0.01) box(ctx, cam, -34, -34, 1034, 594, -70 * dim, 0, '#0a2a30', '#0a2a30');
  ctx.beginPath(); tracePoints(ctx, cam, [[0, 0], [1000, 0], [1000, 560], [0, 560]], true);
  const a = cam.project(0, 0), b = cam.project(1000, 560);
  if (a && b) {
    const bg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    bg.addColorStop(0, '#1b6871'); bg.addColorStop(.5, '#17616b'); bg.addColorStop(1, '#134e58');
    ctx.fillStyle = bg;
  } else ctx.fillStyle = '#17616b';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  for (let x = 30; x < 1000; x += 40) tracePoints(ctx, cam, [[x, 0], [x, 560]]);
  for (let y = 20; y < 560; y += 40) tracePoints(ctx, cam, [[0, y], [1000, y]]);
  ctx.strokeStyle = rgba(C.mint, .13); ctx.lineWidth = 1; ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath(); tracePoints(ctx, cam, [[4, 4], [996, 4], [996, 556], [4, 556]], true); ctx.strokeStyle = rgba(C.mint, .55); ctx.stroke();
  ctx.beginPath(); tracePoints(ctx, cam, [[500, 4], [500, 556]]); tracePoints(ctx, cam, ring(500, 280, 0, 78, 64));
  ctx.strokeStyle = rgba(C.paper, .53); ctx.stroke();
  disc(ctx, cam, 500, 280, 0, 5, C.yellow, 20);
  crease(ctx, cam, 0, C.tealLight); crease(ctx, cam, 1000, C.coral);
  ctx.restore();
}

function crease(ctx, cam, x, color) {
  const dir = x === 0 ? 1 : -1, depth = 88, r = 19;
  const pts = [[x, 180], ...ring(x + dir * (depth - r), 180 + r, 0, r, 10, dir > 0 ? -Math.PI / 2 : -Math.PI / 2, dir > 0 ? 0 : -Math.PI),
    ...ring(x + dir * (depth - r), 380 - r, 0, r, 10, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI / 2 : Math.PI / 2), [x, 380]];
  ctx.beginPath(); tracePoints(ctx, cam, pts, true); ctx.fillStyle = 'rgba(4,27,31,.7)'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath();
  for (let y = 190; y < 380; y += 15) tracePoints(ctx, cam, [[x + dir * 4, y], [x + dir * 76, y]]);
  ctx.strokeStyle = rgba(color, .72); ctx.lineWidth = 1; ctx.stroke();
}

/** Rails rise out of the flat border as dim → 1. `layer`: 'back' (far + sides + goals) or 'front'. */
export function drawRails(ctx, cam, dim, layer) {
  if (dim < 0.02) return;
  const h = 30 * dim, side = '#0f4c55', top = '#d9f3ea';
  ctx.save(); ctx.globalAlpha = smooth(dim * 1.6);
  if (layer === 'back') {
    for (const [x, color] of [[0, C.tealLight], [1000, C.coral]]) goalBox(ctx, cam, x, color, dim);
    box(ctx, cam, -16, -16, 1016, 0, 0, h, side, top);
    box(ctx, cam, -16, 0, 0, 180, 0, h, side, top); box(ctx, cam, 1000, 0, 1016, 180, 0, h, side, top);
    box(ctx, cam, -16, 380, 0, 560, 0, h, side, top); box(ctx, cam, 1000, 380, 1016, 560, 0, h, side, top);
    for (const [x, y] of [[0, 180], [1000, 180], [0, 380], [1000, 380]]) cylinder(ctx, cam, x, y, 0, RINK.postRadius, h + 6 * dim, '#c99a2e', C.yellow, 16);
  } else box(ctx, cam, -16, 560, 1016, 576, 0, h, side, top);
  ctx.restore();
}

function goalBox(ctx, cam, x, color, dim) {
  const out = x === 0 ? -1 : 1, x0 = x === 0 ? -52 : 1000, x1 = x === 0 ? 0 : 1052, h = 40 * dim;
  ctx.beginPath(); tracePoints(ctx, cam, [[x0, 180], [x1, 180], [x1, 380], [x0, 380]], true); ctx.fillStyle = '#06191d'; ctx.fill();
  const back = x + out * 52;
  ctx.beginPath();
  for (let z = 0; z <= h; z += 8 * dim + .01) tracePoints(ctx, cam, [[x, 180, z], [back, 180, z], [back, 380, z], [x, 380, z]]);
  for (let y = 180; y <= 380; y += 20) tracePoints(ctx, cam, [[back, y, 0], [back, y, h]]);
  ctx.strokeStyle = rgba(color, .55); ctx.lineWidth = 1; ctx.stroke();
}

/** Mallets and puck, painter-sorted by camera depth. */
export function drawBodies(ctx, cam, state, dim, alpha = 1) {
  const items = [
    { d: cam.depthOf(state.player.x, state.player.y), f: () => mallet(ctx, cam, state.player, dim, C.tealLight, '#137985') },
    { d: cam.depthOf(state.computer.x, state.computer.y), f: () => mallet(ctx, cam, state.computer, dim, C.coral, '#a4413e') },
  ];
  items.push({ d: cam.depthOf(state.puck.x, state.puck.y), f: () => puck(ctx, cam, state.puck, dim) });
  items.sort((a, b) => b.d - a.d);
  ctx.save(); ctx.globalAlpha = alpha;
  for (const item of items) item.f();
  ctx.restore();
}

function mallet(ctx, cam, m, dim, outer, inner) {
  disc(ctx, cam, m.x + 6, m.y + 9, 0, RINK.malletRadius + 3, 'rgba(3,23,28,.3)', 32);
  cylinder(ctx, cam, m.x, m.y, 0, RINK.malletRadius, 12 * dim, outer, outer, 36);
  cylinder(ctx, cam, m.x, m.y, 12 * dim, RINK.malletRadius * .67, 8 * dim, inner, inner, 28);
  if (dim > .05) cylinder(ctx, cam, m.x, m.y, 20 * dim, 11, 30 * dim, inner, outer, 18);
  disc(ctx, cam, m.x - 9, m.y - 10, (dim > .05 ? 50 : 20) * dim, RINK.malletRadius * .19, 'rgba(244,243,233,.76)', 14);
}

function puck(ctx, cam, p, dim) {
  const s = cam.project(p.x, p.y, 4 * dim);
  if (s) {
    const r = RINK.puckRadius * s.scale * 3;
    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    glow.addColorStop(0, 'rgba(242,189,69,.55)'); glow.addColorStop(1, 'rgba(242,189,69,0)');
    ctx.fillStyle = glow; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
  }
  cylinder(ctx, cam, p.x, p.y, 0, RINK.puckRadius, 8 * dim, '#c38f22', C.yellow, 28);
  disc(ctx, cam, p.x - 4, p.y - 5, 8 * dim, 5, '#fff4bd', 12);
}

/**
 * Trajectory ribbon. opts: { s, lift, decay (0..1), future (0..1), widthScale, focusFrom, focus (0..1) }.
 * focus fades every segment that starts before `focusFrom` to a thin ghost (end-card hero shot).
 * Segment colour = whoever last touched the puck; the live head is a comet.
 */
export function drawTrajectory(ctx, cam, film, opts) {
  const { s, lift = 0, decay = 1, future = 0, widthScale = 1, focusFrom = Infinity, focus = 0 } = opts;
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const seg of film.segments) {
    if (seg.t0 >= s) break;
    const pts = [];
    for (const p of seg.points) { if (p.t > s) break; pts.push([p.x, p.y, zOf(film, lift, p.t) + 2]); }
    const head = film.sample(Math.min(s, seg.t1)).puck;
    pts.push([head.x, head.y, zOf(film, lift, Math.min(s, seg.t1)) + 2]);
    if (pts.length < 2) continue;
    const age = s - seg.t1;
    const hero = seg.t0 >= focusFrom - 1e-6, ghost = hero ? 0 : focus;
    const alpha = (age > 0 ? mix(1, .3, smooth(age / .9) * decay) : 1) * mix(1, .13, ghost);
    const ref = cam.project(pts[0][0], pts[0][1], pts[0][2]);
    const w = clamp((ref ? ref.scale : 1) * 5.5 * widthScale * (hero ? 1 + .7 * focus : mix(1, .45, ghost)), 1.5, 14);
    const color = OWNER[seg.owner];
    ctx.globalAlpha = alpha;
    ctx.beginPath(); tracePoints(ctx, cam, pts);
    ctx.shadowColor = color; ctx.shadowBlur = 22 * (1 - ghost); ctx.strokeStyle = rgba(color, .85); ctx.lineWidth = w; ctx.stroke();
    if (ghost < .9) { ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,240,.85)'; ctx.lineWidth = w * .3; ctx.stroke(); }
  }
  if (future > 0.01) drawFuture(ctx, cam, film, s, lift, future);
  ctx.restore();
}

function drawFuture(ctx, cam, film, s, lift, amount) {
  const upcoming = film.events.filter((e) => e.t > s);
  const horizon = upcoming.length ? upcoming[Math.min(2, upcoming.length - 1)].t : s;
  const pts = [];
  for (let t = s; t <= horizon; t += 1 / 120) { const p = film.sample(t).puck; pts.push([clamp(p.x, -20, 1020), p.y, zOf(film, lift, t) + 3]); }
  if (pts.length < 2) return;
  ctx.globalAlpha = .75 * amount; ctx.setLineDash([10, 12]); ctx.lineDashOffset = -s * 400;
  ctx.beginPath(); tracePoints(ctx, cam, pts); ctx.strokeStyle = C.yellow; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.setLineDash([]);
  for (const e of upcoming.slice(0, 3)) {
    ctx.beginPath(); tracePoints(ctx, cam, ring(clamp(e.x, 0, 1000), e.y, zOf(film, lift, e.t) + 3, 10, 20));
    ctx.strokeStyle = rgba(C.yellow, .9); ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Collision effects. opts: { t (video), s (sim), lift, dim, nodes, callouts, angles, pillars, focusFrom, focus }.
 */
export function drawCollisions(ctx, cam, film, opts) {
  const { t, s, lift = 0, dim = 0, nodes = true, callouts = false, angles = false, pillars = 0, focusFrom = Infinity, focus = 0 } = opts;
  for (const e of film.events) {
    if (e.t > s + 1e-6 || e.type === 'goal') continue;
    const fade = e.t >= focusFrom - 1e-6 ? 1 : 1 - focus;
    if (fade < .02) continue;
    ctx.save(); ctx.globalAlpha = fade;
    const age = t - e.video, z = zOf(film, lift, e.t) + 2, x = clamp(e.x, 0, 1000);
    const color = e.type === 'hit' ? OWNER[e.side] : C.yellow;
    if (pillars > 0) pillar(ctx, cam, x, e.y, z, color, pillars * (e.type === 'hit' ? 1 : .55));
    if (age >= 0 && age < .7) burst(ctx, cam, x, e.y, z, color, age / .7, e.type === 'hit' && e.speed > 1500);
    if (age >= 0 && age < .55 && dim > .3) beam(ctx, cam, x, e.y, z, color, age / .55, dim);
    if (nodes) node(ctx, cam, e, x, z, color);
    if (angles && e.type === 'wall' && age >= 0 && age < 1.5) angleMark(ctx, cam, film, e, z, age / 1.5);
    if (callouts && e.type === 'hit' && age >= 0 && age < 1.0) callout(ctx, cam, e, z, color, age);
    ctx.restore();
  }
}

function burst(ctx, cam, x, y, z, color, k, heavy) {
  const r = 22 + easeOut(k) * (heavy ? 90 : 60);
  ctx.save(); ctx.globalAlpha *= (1 - k) * .9;
  ctx.beginPath(); tracePoints(ctx, cam, ring(x, y, z, r, 40)); ctx.strokeStyle = color; ctx.lineWidth = heavy ? 5 : 3; ctx.stroke();
  ctx.beginPath();
  const rays = heavy ? 14 : 9;
  for (let i = 0; i < rays; i += 1) {
    const a = i * Math.PI * 2 / rays + k * .6;
    tracePoints(ctx, cam, [[x + Math.cos(a) * r * .72, y + Math.sin(a) * r * .72, z], [x + Math.cos(a) * (r + (heavy ? 24 : 14)), y + Math.sin(a) * (r + (heavy ? 24 : 14)), z]]);
  }
  ctx.strokeStyle = C.paper; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
}

function beam(ctx, cam, x, y, z, color, k, dim) {
  const a = cam.project(x, y, z), b = cam.project(x, y, z + 220 * dim * easeOut(k * 1.5));
  if (!a || !b) return;
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, rgba(color, (1 - k) * .95)); g.addColorStop(1, rgba(color, 0));
  ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = 7 * (1 - k * .6); ctx.shadowColor = color; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
}

function pillar(ctx, cam, x, y, z, color, amount) {
  if (z < 4) return;
  ctx.save(); ctx.globalAlpha *= .55 * amount; ctx.setLineDash([4, 6]);
  ctx.beginPath(); tracePoints(ctx, cam, [[x, y, 0], [x, y, z]]); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.setLineDash([]); ctx.beginPath(); tracePoints(ctx, cam, ring(x, y, 0, 7, 16)); ctx.stroke(); ctx.restore();
}

function node(ctx, cam, e, x, z, color) {
  const p = cam.project(x, e.y, z);
  if (!p) return;
  ctx.save();
  if (e.type === 'hit') {
    const r = clamp(p.scale * 9, 5, 14);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.font = `600 ${Math.round(clamp(p.scale * 11, 10, 17))}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = rgba(C.inkDeep, .8); const label = String(e.index).padStart(2, '0');
    ctx.strokeText(label, p.x + r + 4, p.y - r); ctx.fillStyle = C.paper; ctx.fillText(label, p.x + r + 4, p.y - r);
  } else {
    const r = clamp(p.scale * 5, 3, 8);
    ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = color; ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.ink; ctx.strokeRect(-r, -r, r * 2, r * 2);
  }
  ctx.restore();
}

function angleMark(ctx, cam, film, e, z, k) {
  const fade = k < .15 ? k / .15 : 1 - smooth((k - .65) / .35);
  const inward = e.horizontalWall ? (e.y < 280 ? 1 : -1) : (e.x < 500 ? 1 : -1);
  const n = e.horizontalWall ? [0, inward] : [inward, 0];
  const before = film.sample(e.t - ANGLE_WINDOW).puck, after = film.sample(e.t + ANGLE_WINDOW).puck;
  const dirIn = norm2([before.x - e.x, before.y - e.y]), dirOut = norm2([after.x - e.x, after.y - e.y]);
  const L = 150, R = 62, grow = easeOut(k / .3);
  ctx.save(); ctx.globalAlpha *= fade;
  ctx.setLineDash([6, 6]); ctx.beginPath(); tracePoints(ctx, cam, [[e.x, e.y, z], [e.x + n[0] * L * grow, e.y + n[1] * L * grow, z]]);
  ctx.strokeStyle = C.paper; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
  const lastHit = [...film.hits].reverse().find((h) => h.t < e.t);
  for (const [dir, color] of [[dirIn, OWNER[lastHit ? lastHit.side : 'serve']], [dirOut, C.yellow]]) {
    ctx.beginPath(); tracePoints(ctx, cam, [[e.x, e.y, z], [e.x + dir[0] * L * grow, e.y + dir[1] * L * grow, z]]);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    const a0 = Math.atan2(n[1], n[0]), a1 = Math.atan2(dir[1], dir[0]);
    let da = a1 - a0; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    ctx.beginPath(); tracePoints(ctx, cam, ring(e.x, e.y, z, R, 16, a0, a0 + da * grow)); ctx.lineWidth = 2.5; ctx.stroke();
  }
  const label = cam.project(e.x + n[0] * (L + 34), e.y + n[1] * (L + 34), z);
  if (label) {
    ctx.font = `600 22px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = `入射 ${e.inDeg.toFixed(1)}°  ·  反射 ${e.outDeg.toFixed(1)}°`;
    const w = ctx.measureText(text).width + 28;
    ctx.fillStyle = rgba(C.inkDeep, .82); ctx.fillRect(label.x - w / 2, label.y - 19, w, 38);
    ctx.fillStyle = C.paper; ctx.fillText(text, label.x, label.y + 1);
  }
  ctx.restore();
}

function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

function callout(ctx, cam, e, z, color, age) {
  const p = cam.project(e.x, e.y, z);
  if (!p) return;
  const fade = age < .1 ? age / .1 : 1 - smooth((age - .7) / .3);
  const dx = e.x < 500 ? 1 : -1, ox = p.x + dx * 64, oy = p.y - 70 - age * 18;
  ctx.save(); ctx.globalAlpha *= fade;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ox, oy); ctx.strokeStyle = C.paper; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = `600 20px ${MONO}`; ctx.textBaseline = 'middle';
  const text = `HIT ${String(e.index).padStart(2, '0')}  ${Math.round(e.speed)} PX/S`;
  const w = ctx.measureText(text).width + 26, x0 = dx > 0 ? ox : ox - w;
  ctx.fillStyle = C.paper; ctx.fillRect(x0, oy - 18, w, 36);
  ctx.fillStyle = color === OWNER.player ? C.tealDark : '#a4413e'; ctx.fillRect(x0, oy - 18, 6, 36);
  ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(text, x0 + 16, oy + 1);
  ctx.restore();
}
