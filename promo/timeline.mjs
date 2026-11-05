// Film timeline: rally analysis, time warps (slow motion), shots and camera curves.
import { RINK } from '../physics.mjs';
import { simulateRally, sampleRally, puckPath } from './rally.mjs';
import { deg, mix, clamp, smooth, easeInOut } from './camera3d.mjs';

export const FPS = 60;
export const DURATION = 40;
/** Closing Toy segment (rink becomes a Toy tile) and the voice-over start inside it. */
export const TOY_START = 30;
export const VO_START = 30.4;
export const SEED = 449;

const POSTS = [[0, 180], [0, 380], [1000, 180], [1000, 380]];

/** Collapse engine contact chatter into distinct, film-worthy collisions. */
function distinctEvents(rally) {
  const out = [];
  for (const e of rally.events) {
    if (e.type === 'goal' || e.type === 'finish') { out.push({ type: 'goal', side: e.side || e.winner, t: e.t, x: 1016, y: sampleRally(rally, e.t).puck.y }); continue; }
    if (e.type !== 'hit' && e.type !== 'wall') continue;
    const nearPost = POSTS.some(([x, y]) => Math.hypot(e.x - x, e.y - y) <= RINK.puckRadius + RINK.postRadius + 1.5);
    const type = e.type === 'hit' ? 'hit' : nearPost ? 'post' : 'wall';
    const key = type === 'hit' ? `hit:${e.side}` : type;
    const prev = out[out.length - 1];
    if (prev && prev.key === key && e.t - prev.t < 0.15) { prev.speed = Math.max(prev.speed || 0, e.speed || 0); continue; }
    out.push({ type, key, side: e.side, t: e.t, x: e.x, y: e.y, speed: e.speed || 0 });
  }
  let hits = 0, bounces = 0;
  for (const e of out) {
    if (e.type === 'hit') e.index = ++hits;
    if (e.type === 'wall' || e.type === 'post') e.index = ++bounces;
    // Walls: outgoing speed. Post: incoming speed (the goal zeroes velocity right after it).
    if (e.type !== 'hit') { const v = sampleRally(rally, e.type === 'post' ? e.t - 0.004 : e.t + 0.01).puck; e.speed = Math.hypot(v.vx, v.vy); }
  }
  return out;
}

/** Path segments between collisions, tagged with whoever last touched the puck. */
function buildSegments(rally, events, start) {
  const cuts = events.filter((e) => e.t > start);
  const segments = [];
  let t0 = start, owner = 'serve';
  for (const e of cuts) {
    segments.push({ t0, t1: e.t, owner, points: puckPath(rally, t0, e.t, 2) });
    t0 = e.t;
    if (e.type === 'hit') owner = e.side;
  }
  return segments;
}

export const ANGLE_WINDOW = 0.03;

/** Reflection angles measured from the wall normal, from real engine velocities. */
function bounceAngles(rally, e) {
  const before = sampleRally(rally, e.t - ANGLE_WINDOW).puck, after = sampleRally(rally, e.t + ANGLE_WINDOW).puck;
  const horizontalWall = Math.abs(e.y - RINK.puckRadius) < 2 || Math.abs(e.y - (RINK.height - RINK.puckRadius)) < 2;
  const angle = (v) => Math.atan2(Math.abs(horizontalWall ? v.vx : v.vy), Math.abs(horizontalWall ? v.vy : v.vx)) * 180 / Math.PI;
  return { inDeg: angle(before), outDeg: angle(after), horizontalWall };
}

/**
 * Warp video time onto sim time. dv/ds ∝ 1 + Σ amp·exp(-((s-sk)/w)²), so
 * collisions get slow motion while the shot still covers [s0, s1] in `duration`.
 */
function buildWarp(s0, s1, duration, dips) {
  const n = 3000, cum = new Float64Array(n + 1);
  const weight = (s) => 1 + dips.reduce((sum, d) => sum + d.amp * Math.exp(-(((s - d.s) / d.w) ** 2)), 0);
  for (let i = 1; i <= n; i += 1) cum[i] = cum[i - 1] + weight(s0 + (s1 - s0) * (i - .5) / n);
  const total = cum[n];
  const simAt = (u) => {
    const target = clamp(u, 0, 1) * total;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid; }
    const f = (target - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return s0 + (s1 - s0) * (lo + f) / n;
  };
  const uAt = (s) => { const i = clamp(Math.round((s - s0) / (s1 - s0) * n), 0, n); return cum[i] / total; };
  return { s0, s1, duration, simAt, uAt };
}

export function buildFilm() {
  const rally = simulateRally(SEED);
  const events = distinctEvents(rally);
  const R0 = rally.serveTime;
  const goal = events.find((e) => e.type === 'goal');
  const hits = events.filter((e) => e.type === 'hit');
  const bounces = events.filter((e) => e.type === 'wall' || e.type === 'post');
  const powerShot = hits[hits.length - 1];
  const post = bounces.find((e) => e.type === 'post' && e.t > powerShot.t);
  const start = R0 - 0.35;
  const segments = buildSegments(rally, events, start);
  for (const e of bounces) if (e.type === 'wall') Object.assign(e, bounceAngles(rally, e));
  if (!goal || goal.side !== 'player' || !post || post.t < powerShot.t) {
    throw new Error(`seed ${SEED}: the film script needs a rally that ends in a player goal off the post`);
  }

  const hitDips = (from, to, amp, w) => events.filter((e) => e.t > from && e.t < to && e.type === 'hit').map((e) => ({ s: e.t, amp, w }));
  const s2End = R0 + 3.5, s3End = R0 + 4.35;
  const warps = {
    flat: { v0: 3.4, ...buildWarp(start, s2End, 7.6, hitDips(start, s2End, 2.6, 0.045)) },
    tilt: { v0: 11.0, ...buildWarp(s2End, s3End, 3.0, []) },
    deep: { v0: 14.0, ...buildWarp(s3End, goal.t, 5.8, [
      ...bounces.filter((e) => e.t > s3End && e.t < powerShot.t).map((e) => ({ s: e.t, amp: 1.4, w: 0.035 })),
      { s: powerShot.t, amp: 9, w: 0.05 }, { s: post.t, amp: 12, w: 0.035 }]) },
  };
  const warpList = [warps.flat, warps.tilt, warps.deep];

  /** Sim time shown at video time t (frozen outside rally shots). */
  function simTimeAt(t) {
    if (t < warps.flat.v0) return start;
    for (const w of warpList) if (t < w.v0 + w.duration) return w.simAt((t - w.v0) / w.duration);
    return goal.t;
  }
  /** Video time at which a sim instant is first shown. */
  function videoTimeOf(s) {
    for (const w of warpList) if (s <= w.s1) return w.v0 + w.uAt(s) * w.duration;
    return warps.deep.v0 + warps.deep.duration;
  }
  /** Playback rate (sim s per video s) inside a rally shot; 0 when the picture is frozen. */
  function rateAt(t) {
    const w = warpList.find((x) => t >= x.v0 && t < x.v0 + x.duration);
    if (!w) return 0;
    const e = 1 / (240 * w.duration), u = (t - w.v0) / w.duration;
    const u0 = Math.max(0, u - e), u1 = Math.min(1, u + e);
    return (w.simAt(u1) - w.simAt(u0)) / ((u1 - u0) * w.duration);
  }
  /** Lift-shot replay head: sim time and playback rate at video time t. */
  const replayAt = (t) => start + (goal.t - start) * smooth((t - 21.6) / 2.4);
  const replayRate = (t) => (replayAt(t + 1 / 120) - replayAt(t - 1 / 120)) * 60;
  for (const e of events) e.video = videoTimeOf(e.t);

  return { seed: SEED, rally, events, hits, bounces, powerShot, post, goal, R0, start, segments, simTimeAt, videoTimeOf, rateAt, replayAt, replayRate, sample: (s) => sampleRally(rally, s) };
}

/** Stateless smoothed puck focus: average of puck positions in a sim-time window. */
function puckFocus(film, s, half = 0.22) {
  let x = 0, y = 0;
  for (let i = 0; i <= 8; i += 1) { const p = film.sample(s - half + half * 2 * i / 8).puck; x += clamp(p.x, 0, 1000); y += p.y; }
  return [x / 9, y / 9];
}

const poseKeys = ['yaw', 'pitch', 'fov', 'distance', 'offsetX', 'offsetY'];

/** Resolve a pose's camera distance (poses are authored either by fitWidth or by distance). */
function withDistance(pose, width, height) {
  if (pose.distance !== undefined) return pose;
  const focal = (height / 2) / Math.tan(pose.fov / 2);
  return { ...pose, distance: (pose.fit / (width * 0.78)) * focal };
}

function blendPose(a, b, k) {
  const out = { target: a.target.map((v, i) => mix(v, b.target[i], k)) };
  for (const key of poseKeys) out[key] = mix(a[key] || 0, b[key] || 0, k);
  return out;
}

/**
 * Low three-quarter chase camera locked behind the power shot: it rides with the
 * puck toward the post and goal, then orbits the frozen puck (bullet time).
 */
function chasePose(film, t) {
  const from = film.powerShot, to = film.post;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1, dir = [(to.x - from.x) / len, (to.y - from.y) / len];
  const behindYaw = Math.atan2(-dir[0], -dir[1]) + deg(25);
  const frozen = t > film.goal.video;
  const s = frozen ? film.goal.t : film.simTimeAt(t);
  const p = film.sample(s).puck, travel = clamp((s - from.t) / (to.t - from.t), 0, 1);
  const orbit = frozen ? easeInOut((t - film.goal.video) / 0.8) : 0;
  const ahead = mix(110, 40, orbit);
  return { target: [clamp(p.x, 0, 1030) + dir[0] * ahead, p.y + dir[1] * ahead, 6], yaw: behindYaw + deg(6) * travel + deg(55) * orbit,
    pitch: deg(15) + deg(7) * orbit, fov: deg(56), distance: mix(290, 225, orbit), offsetX: 0, offsetY: 70 };
}

/** Rally 3D pose before the chase takes over. */
function deepPose(film, t) {
  const s = film.simTimeAt(Math.min(t, film.goal.video));
  const focus = puckFocus(film, s, 0.18);
  const k = smooth((t - 14) / 6);
  const close = smooth((s - (film.powerShot.t - 0.5)) / 0.5);
  const pull = 0.55 + 0.4 * close;
  return { target: [mix(500, focus[0], pull), mix(300, focus[1], .8 * close), 10 * close], yaw: mix(deg(-14), deg(16), k) - deg(10) * close,
    pitch: mix(deg(34), deg(24), k) - deg(6) * close, fov: deg(44), fit: mix(1180, 980, k) - 330 * close, offsetY: 40 };
}

/** 0 → 1 as the camera whips from the rally view into the chase. */
export const chaseAmount = (film, t) => (t >= 20.6 ? 0 : easeInOut((t - (film.powerShot.video - 0.12)) / 0.62));

/**
 * Per-frame look: camera, dimensionality, backdrop darkness, lift of the time axis.
 * dim: 0 = flat 2D game view, 1 = full 3D extrusion. lift: 0..1 time-axis sculpture.
 */
export function lookAt(film, t, width, height) {
  const top = { target: [500, 280, 0], yaw: 0, pitch: deg(90), fov: deg(12), fit: 1060, offsetY: 6 };
  const D = (pose) => withDistance(pose, width, height);
  let cam = top, dim = 0, dark = 0, lift = 0, view = '2D · TOP VIEW';
  if (t < 11) {
    const k = smooth((t - 3.4) / 7.6);
    cam = { ...top, fit: mix(1240, 1180, k), offsetX: 150 };
  } else if (t < 14) {
    const k = easeInOut((t - 11.1) / 2.7);
    const focus = puckFocus(film, film.simTimeAt(t));
    cam = { target: [mix(500, mix(500, focus[0], .3), k), mix(280, 300, k), 0], yaw: mix(0, deg(-14), k), pitch: mix(deg(90), deg(34), k),
      fov: mix(deg(12), deg(44), k), fit: 1180, offsetX: mix(150, 0, k), offsetY: mix(6, 40, k) };
    dim = k; dark = smooth((t - 11) / 2.2); view = k < .5 ? '2D → 3D' : '3D · PERSPECTIVE';
  } else if (t < 20.6) {
    const k = chaseAmount(film, t);
    cam = k > 0 ? blendPose(D(deepPose(film, t)), chasePose(film, t), k) : deepPose(film, t);
    dim = 1; dark = 1; view = k > .5 ? (t > film.goal.video ? '3D · BULLET TIME' : '3D · CHASE CAM') : '3D · PERSPECTIVE';
  } else if (t < 25.6) {
    const k = easeInOut((t - 20.6) / 3.6);
    const back = easeInOut((t - 24.15) / 1.45);
    lift = smooth((t - 20.7) / 1.2) * (1 - back);
    const orbit = { target: [500, 280, 150 * lift], yaw: mix(deg(-38), deg(26), k), pitch: deg(22), fov: deg(42), fit: 1420, offsetY: 30 };
    cam = { target: orbit.target.map((v, i) => mix(v, top.target[i], back)), yaw: mix(orbit.yaw, 0, back), pitch: mix(orbit.pitch, top.pitch, back),
      fov: mix(orbit.fov, top.fov, back), fit: mix(orbit.fit, 1060, back), offsetY: mix(30, 6, back) };
    const release = easeInOut((t - 20.6) / 0.8);
    if (release < 1) cam = blendPose(chasePose(film, 20.6), D(cam), release);
    dim = 1 - back; dark = 1 - smooth((t - 24.6) / 1.0); view = back > .5 ? '2D · TOP VIEW' : '3D · TIME AXIS';
  } else {
    const k = easeInOut((t - 25.6) / 1.4);
    cam = { ...top, fit: mix(1060, 1750, k), offsetX: mix(0, 380, k), offsetY: mix(6, -20, k) };
    view = '2D · TOP VIEW';
  }
  cam = D(cam);
  return { cam: { target: cam.target, yaw: cam.yaw, pitch: cam.pitch, fov: cam.fov, distance: cam.distance, width, height,
    offsetX: cam.offsetX || 0, offsetY: cam.offsetY || 0 }, dim, dark, lift, view, chase: chaseAmount(film, t) };
}
