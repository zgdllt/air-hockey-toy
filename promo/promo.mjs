// Director: composes one frame of the promo film from video time t (stateless,
// so the preview can scrub and the recorder can render frames in any order).
import { buildFilm, lookAt, DURATION, FPS, TOY_START } from './timeline.mjs';
import { makeCamera, smooth, easeOut, clamp } from './camera3d.mjs';
import { drawRink, drawRails, drawBodies, drawTrajectory, drawCollisions, zOf, C } from './scene.mjs';
import { drawBackdrop, drawTitle, titlePuck, caption, drawHud, drawGoalSlam, drawTimeAxis, drawEndCard } from './overlay.mjs';
import { toyLook, drawToyTileBack, drawToyTileFront, drawToyText, endCardFade } from './toycard.mjs';

export const WIDTH = 1920, HEIGHT = 1080;
export { DURATION, FPS };

export function createDirector() {
  const film = buildFilm();
  const rallySeconds = (film.goal.t - film.R0).toFixed(1);
  const captions = [
    { t0: 3.9, t1: 6.9, en: 'ONE HIT', zh: '一次碰撞', x: 56, y: 430, size: 60 },
    { t0: 7.2, t1: 10.7, en: 'REWRITES THE PATH', zh: '改写一条轨迹', x: 56, y: 430, size: 60 },
    { t0: 11.3, t1: 13.9, en: 'FROM 2D TO 3D', zh: '换个维度看' },
    { t0: 14.3, t1: 17.4, en: 'EVERY BOUNCE KEEPS ITS ANGLE', zh: '每次反弹，都有角度' },
    { t0: film.powerShot.video + .05, t1: film.goal.video - .05, en: `FULL POWER · ${Math.round(film.powerShot.speed)} PX/S`, zh: '满速一击' },
    { t0: 21.4, t1: 24.3, en: `${film.hits.length} HITS · ${film.bounces.length} BOUNCES · 1 GOAL`, zh: `把 ${rallySeconds} 秒立起来` },
  ];
  const heavy = film.events.filter((e) => (e.type === 'hit' && e.speed > 1500) || e.type === 'goal');

  function shakeAt(t) {
    let amount = 0;
    for (const e of heavy) {
      const age = t - e.video;
      if (age < 0 || age > .5) continue;
      const big = e === film.powerShot || e.type === 'goal' ? 16 : 5;
      amount += big * Math.exp(-age * 9);
    }
    return [Math.sin(t * 91) * amount, Math.cos(t * 73) * amount * .7];
  }

  /** Camera for time t; the Toy segment pulls the end-card view back into a tile. */
  const lookFor = (t) => (t >= TOY_START ? toyLook(lookAt(film, t, WIDTH, HEIGHT), t) : lookAt(film, t, WIDTH, HEIGHT));

  function world(ctx, t, look = lookFor(t)) {
    const cam = makeCamera(look.cam);
    const sculpt = t >= 20.6 && t < 25.6;
    const s = t >= 20.6 ? film.goal.t : film.simTimeAt(t);
    const replay = sculpt ? film.replayAt(t) : null;
    const [sx, sy] = shakeAt(t);
    ctx.save(); ctx.translate(sx, sy);
    if (t >= TOY_START) drawToyTileBack(ctx, t, cam);
    drawRink(ctx, cam, look.dim);
    drawRails(ctx, cam, look.dim, 'back');
    const future = t < 11.4 ? 0 : t < 14 ? smooth((t - 11.4) / .6) : t < 17.2 ? 1 - smooth((t - 16.6) / .6)
      : t < film.goal.video ? smooth((t - film.powerShot.video - .1) / .4) : 0;
    const focus = { focusFrom: film.powerShot.t, focus: smooth((t - 25.6) / .9) };
    drawTrajectory(ctx, cam, film, { s, lift: look.lift, decay: t >= 20.6 ? 0 : 1, future, widthScale: t >= 25.6 ? .8 : 1, ...focus });
    drawCollisions(ctx, cam, film, { t, s, lift: look.lift, dim: look.dim, nodes: true, ...focus,
      callouts: t < 11 || (t > 17 && t < 20.6), angles: t > 14 && t < 17.6, pillars: look.lift });
    if (replay !== null && replay > film.start && replay < film.goal.t) replayHead(ctx, cam, film, replay, look.lift);
    const state = film.sample(Math.min(s, film.goal.t));
    drawBodies(ctx, cam, state, look.dim, sculpt ? 1 - look.lift * .75 : 1);
    drawRails(ctx, cam, look.dim, 'front');
    drawTimeAxis(ctx, cam, film, look.lift, zOf);
    if (t >= TOY_START) drawToyTileFront(ctx, t, cam);
    ctx.restore();
    if (look.chase > .05 && t < film.goal.video) {
      const p = film.sample(s).puck, q = cam.project(clamp(p.x, 0, 1030), p.y, 4);
      if (q) speedLines(ctx, q.x, q.y, t, look.chase * (1 - smooth((t - film.post.video + .1) / .25)));
    }
    return { look, s };
  }

  /** Radial streaks around the puck during the chase (deterministic per frame). */
  function speedLines(ctx, cx, cy, t, amount) {
    if (amount <= .01) return;
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < 46; i += 1) {
      const a = (i * 2.399963) % (Math.PI * 2), phase = (t * 1.4 + i * .618) % 1;
      const r0 = 170 + phase * 900, len = 60 + (i % 5) * 34;
      ctx.globalAlpha = amount * .32 * (1 - phase) * smooth(phase * 6);
      ctx.strokeStyle = i % 3 ? C.paper : C.yellow; ctx.lineWidth = 1.5 + (i % 3);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len)); ctx.stroke();
    }
    ctx.restore();
  }

  function replayHead(ctx, cam, film, s, lift) {
    const p = film.sample(s).puck, q = cam.project(clamp(p.x, 0, 1000), p.y, zOf(film, lift, s) + 2);
    if (!q) return;
    const r = 40;
    const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
    g.addColorStop(0, 'rgba(255,248,214,1)'); g.addColorStop(.35, 'rgba(242,189,69,.85)'); g.addColorStop(1, 'rgba(242,189,69,0)');
    ctx.fillStyle = g; ctx.fillRect(q.x - r, q.y - r, r * 2, r * 2);
  }

  /** Render the frame at video time t into a 1920×1080 2D context. */
  function renderAt(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    t = clamp(t, 0, DURATION);
    if (t < 3.4) {
      drawBackdrop(ctx, 0); drawTitle(ctx, t);
      if (t > 2.72) {
        const pts = titlePuck(t), head = pts[pts.length - 1];
        const r = easeOut((t - 2.72) / .68) ** 1.4 * 2300;
        ctx.save(); ctx.beginPath(); ctx.arc(head[0], head[1], r, 0, Math.PI * 2); ctx.clip();
        drawBackdrop(ctx, 0); world(ctx, t); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.arc(head[0], head[1], r, 0, Math.PI * 2); ctx.lineWidth = 10; ctx.strokeStyle = C.yellow; ctx.stroke(); ctx.restore();
      }
      return;
    }
    const look0 = lookFor(t);
    drawBackdrop(ctx, look0.dark);
    const { look, s } = world(ctx, t, look0);
    const hudAlpha = smooth((t - 3.5) / .5) * (1 - smooth((t - 25.3) / .4));
    drawHud(ctx, film, t, s, look, hudAlpha);
    for (const c of captions) caption(ctx, t, c);
    drawGoalSlam(ctx, t, film.goal.video, `GOAL  ·  OFF THE POST  ·  ${film.goal.side === 'player' ? '1 : 0' : '0 : 1'}`);
    if (t >= 25.6 && t < TOY_START + .25) drawEndCard(ctx, t, film, endCardFade(t));
    if (t >= TOY_START) drawToyText(ctx, t);
  }

  return { film, renderAt };
}
