// Minimal perspective camera + canvas primitives. World units are rink pixels:
// x → right, y → toward the viewer (game "down"), z → up off the table.
// pitch = 90° is the game's flat top view; lower pitch tilts into 3D.

export const deg = (d) => d * Math.PI / 180;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const easeInOut = (t) => { const x = clamp(t, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/**
 * Build a camera.
 * @param {{target:number[], yaw:number, pitch:number, fov:number, fitWidth:number, width:number, height:number, roll?:number, offsetX?:number, offsetY?:number}} o
 *   fitWidth: world width that should span `width * 0.78` pixels at the target depth.
 */
export function makeCamera(o) {
  const { target, yaw, pitch, fov, width, height } = o;
  const focal = (height / 2) / Math.tan(fov / 2);
  const distance = o.distance ?? (o.fitWidth / (width * 0.78)) * focal;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const eye = [target[0] + sy * cp * distance, target[1] + cy * cp * distance, target[2] + sp * distance];
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = [cy, -sy, 0];
  const u = cross(f, r);
  const roll = o.roll || 0;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const right = [r[0] * cr + u[0] * sr, r[1] * cr + u[1] * sr, r[2] * cr + u[2] * sr];
  const up = [u[0] * cr - r[0] * sr, u[1] * cr - r[1] * sr, u[2] * cr - r[2] * sr];
  const cx0 = width / 2 + (o.offsetX || 0), cy0 = height / 2 + (o.offsetY || 0);
  return {
    eye, forward: f, right, up, focal, distance, width, height,
    /** World → camera space [right, up, depth]. */
    toCam(x, y, z = 0) {
      const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      return [dx * right[0] + dy * right[1] + dz * right[2], dx * up[0] + dy * up[1] + dz * up[2], dx * f[0] + dy * f[1] + dz * f[2]];
    },
    /** Camera space → screen (caller guarantees depth ≥ NEAR). */
    toScreen(c) { const s = focal / c[2]; return { x: cx0 + c[0] * s, y: cy0 - c[1] * s }; },
    /** Project a world point; returns null when it is in front of the near plane. */
    project(x, y, z = 0) {
      const c = this.toCam(x, y, z);
      if (c[2] < NEAR) return null;
      const s = focal / c[2];
      return { x: cx0 + c[0] * s, y: cy0 - c[1] * s, depth: c[2], scale: s };
    },
    depthOf(x, y, z = 0) {
      return (x - eye[0]) * f[0] + (y - eye[1]) * f[1] + (z - eye[2]) * f[2];
    },
  };
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

const NEAR = 4;
const cut = (a, b) => { const k = (NEAR - a[2]) / (b[2] - a[2]); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]; };

/**
 * Trace a projected polyline/polygon into the current path, clipped against the
 * camera's near plane (needed when a low chase camera sits inside the rink).
 */
export function tracePoints(ctx, cam, points, close = false) {
  const cs = points.map((p) => cam.toCam(p[0], p[1], p[2] || 0));
  if (close) {
    const out = [];
    for (let i = 0; i < cs.length; i += 1) {
      const cur = cs[i], prev = cs[(i + cs.length - 1) % cs.length];
      const curIn = cur[2] >= NEAR, prevIn = prev[2] >= NEAR;
      if (curIn) { if (!prevIn) out.push(cut(prev, cur)); out.push(cur); } else if (prevIn) out.push(cut(prev, cur));
    }
    if (out.length < 3) return;
    out.forEach((c, i) => { const s = cam.toScreen(c); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
    ctx.closePath();
    return;
  }
  for (let i = 0; i < cs.length; i += 1) {
    const cur = cs[i], curIn = cur[2] >= NEAR;
    if (i === 0) { if (curIn) { const s = cam.toScreen(cur); ctx.moveTo(s.x, s.y); } continue; }
    const prev = cs[i - 1], prevIn = prev[2] >= NEAR;
    if (prevIn && curIn) { const s = cam.toScreen(cur); ctx.lineTo(s.x, s.y); }
    else if (prevIn) { const s = cam.toScreen(cut(prev, cur)); ctx.lineTo(s.x, s.y); }
    else if (curIn) { const a = cam.toScreen(cut(prev, cur)), b = cam.toScreen(cur); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  }
}

export function ring(cx, cy, z, r, n = 48, a0 = 0, a1 = Math.PI * 2) {
  const out = [];
  for (let i = 0; i <= n; i += 1) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
  return out;
}

/** Filled horizontal disc on plane z. */
export function disc(ctx, cam, cx, cy, z, r, fill, n = 48) {
  ctx.beginPath(); tracePoints(ctx, cam, ring(cx, cy, z, r, n), true); ctx.fillStyle = fill; ctx.fill();
}

/** Vertical cylinder with camera-facing side quads and a top cap. Height 0 → flat disc. */
export function cylinder(ctx, cam, cx, cy, z0, r, h, side, top, n = 40) {
  if (h > 0.5) {
    const light = [-0.45, -0.6, 0.66];
    for (let i = 0; i < n; i += 1) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const nx = Math.cos(am), ny = Math.sin(am);
      const toEye = [cam.eye[0] - (cx + nx * r), cam.eye[1] - (cy + ny * r)];
      if (nx * toEye[0] + ny * toEye[1] <= 0) continue;
      const shade = clamp(0.55 + 0.45 * (nx * light[0] + ny * light[1]), 0.2, 1);
      ctx.beginPath();
      tracePoints(ctx, cam, [[cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0],
        [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z0 + h], [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z0 + h]], true);
      ctx.fillStyle = shadeColor(side, shade); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  disc(ctx, cam, cx, cy, z0 + h, r, top, n);
}

/** Axis-aligned box (x0..x1, y0..y1, z0..z1), only camera-facing faces. */
export function box(ctx, cam, x0, y0, x1, y1, z0, z1, color, topColor = color) {
  const faces = [
    { n: [0, 0, 1], c: [x0, y0, z1], q: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], k: 1 },
    { n: [0, -1, 0], c: [x0, y0, z0], q: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], k: .62 },
    { n: [0, 1, 0], c: [x0, y1, z0], q: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], k: .8 },
    { n: [-1, 0, 0], c: [x0, y0, z0], q: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], k: .7 },
    { n: [1, 0, 0], c: [x1, y0, z0], q: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], k: .7 },
  ];
  for (const face of faces) {
    const v = [cam.eye[0] - face.c[0], cam.eye[1] - face.c[1], cam.eye[2] - face.c[2]];
    if (face.n[0] * v[0] + face.n[1] * v[1] + face.n[2] * v[2] <= 0) continue;
    ctx.beginPath(); tracePoints(ctx, cam, face.q, true);
    ctx.fillStyle = face.k === 1 ? topColor : shadeColor(color, face.k); ctx.fill();
  }
}

const colorCache = new Map();
/** Multiply a #rrggbb colour by k (0..1+). */
export function shadeColor(hex, k) {
  const key = hex + k.toFixed(2);
  if (colorCache.has(key)) return colorCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => clamp(Math.round(v * k), 0, 255);
  const out = `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  colorCache.set(key, out);
  return out;
}

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
}
