// Deterministic rally capture for the promo film.
// Runs the game's own physics model (../physics.mjs) with a seeded RNG and a
// bot on the blue side, then records every 240 Hz step plus collision events.
import { AirHockey, RINK } from '../physics.mjs';

export const SIM_STEP = 1 / 240;
const BOT_REACTION = 0.06;
const MAX_PLAY_SECONDS = 16;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Mulberry32: small, fast, seedable PRNG. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mirror of the computer's think(): defend the left goal, attack behind the puck. */
function makeBlueBot(game, random) {
  let timer = 0;
  let aim = 0;
  return (dt) => {
    timer -= dt;
    if (timer > 0) return;
    timer = BOT_REACTION;
    const p = game.puck;
    let x = 150;
    let y = 280 + (p.y - 280) * 0.45;
    if (p.vx < 0) {
      x = clamp(p.x - 100, 125, 360);
      const travel = Math.max(0, (p.x - x) / -p.vx);
      const span = RINK.height - RINK.puckRadius * 2;
      const unfolded = p.y - RINK.puckRadius + p.vy * travel;
      const folded = ((unfolded % (span * 2)) + span * 2) % (span * 2);
      y = RINK.puckRadius + (folded > span ? span * 2 - folded : folded);
      aim = (random() - 0.5) * 44;
    }
    if (p.x < 430) {
      const aligned = Math.abs(game.player.y - p.y) < 48;
      y = p.y + aim;
      x = aligned ? p.x + 65 : p.x - 88;
    }
    game.setTarget(x, y);
  };
}

/**
 * Simulate one rally from serve to the first goal (or dead ball / timeout).
 * @param {number} seed RNG seed shared by the engine and the blue bot.
 * @returns {{seed:number, frames:Float32Array, count:number, events:Array, serveTime:number, endTime:number, outcome:string}}
 */
export function simulateRally(seed) {
  const random = seededRandom(seed);
  const events = [];
  let simTime = 0;
  const game = new AirHockey({
    difficulty: 'standard',
    random,
    onEvent: (event) => events.push({ ...event, t: simTime }),
  });
  const bot = makeBlueBot(game, seededRandom(seed ^ 0x9e3779b9));
  game.start('standard');
  const maxSteps = Math.ceil((MAX_PLAY_SECONDS + 3) / SIM_STEP);
  // 8 floats per frame: puck x,y,vx,vy | player x,y | computer x,y
  const frames = new Float32Array(maxSteps * 8);
  let count = 0;
  let outcome = 'timeout';
  for (let index = 0; index < maxSteps; index += 1) {
    bot(SIM_STEP);
    simTime += SIM_STEP; // events emitted during this step belong to frame time (i+1)·STEP
    game.step(SIM_STEP);
    const o = count * 8;
    frames[o] = game.puck.x; frames[o + 1] = game.puck.y;
    frames[o + 2] = game.puck.vx; frames[o + 3] = game.puck.vy;
    frames[o + 4] = game.player.x; frames[o + 5] = game.player.y;
    frames[o + 6] = game.computer.x; frames[o + 7] = game.computer.y;
    count += 1;
    const last = events[events.length - 1];
    if (last && (last.type === 'goal' || last.type === 'finish')) { outcome = `goal:${last.side || last.winner}`; break; }
    if (last && last.type === 'deadball') { outcome = 'deadball'; break; }
  }
  const serve = events.find((event) => event.type === 'serve');
  return { seed, frames, count, events, serveTime: serve ? serve.t : 0, endTime: simTime, outcome };
}

/** Summary used to rank candidate seeds (see find-seed.mjs). */
export function rallyStats(rally) {
  const hits = rally.events.filter((event) => event.type === 'hit');
  const walls = rally.events.filter((event) => event.type === 'wall');
  const playerHits = hits.filter((event) => event.side === 'player');
  return {
    seed: rally.seed,
    outcome: rally.outcome,
    hits: hits.length,
    walls: walls.length,
    duration: +(rally.endTime - rally.serveTime).toFixed(2),
    fastest: Math.round(Math.max(0, ...playerHits.map((event) => event.speed))),
  };
}

/** Interpolated state at a simulation time. */
export function sampleRally(rally, t) {
  const position = clamp(t / SIM_STEP - 1, 0, rally.count - 1);
  const i = Math.floor(position);
  const j = Math.min(rally.count - 1, i + 1);
  const f = position - i;
  const a = i * 8, b = j * 8, d = rally.frames;
  const lerp = (k) => d[a + k] + (d[b + k] - d[a + k]) * f;
  return {
    puck: { x: lerp(0), y: lerp(1), vx: lerp(2), vy: lerp(3) },
    player: { x: lerp(4), y: lerp(5) },
    computer: { x: lerp(6), y: lerp(7) },
  };
}

/** Puck positions between two sim times, downsampled to `stride` steps. */
export function puckPath(rally, t0, t1, stride = 2) {
  const out = [];
  const i0 = clamp(Math.floor(t0 / SIM_STEP) - 1, 0, rally.count - 1);
  const i1 = clamp(Math.floor(t1 / SIM_STEP) - 1, 0, rally.count - 1);
  for (let i = i0; i <= i1; i += stride) {
    out.push({ x: rally.frames[i * 8], y: rally.frames[i * 8 + 1], t: (i + 1) * SIM_STEP });
  }
  const end = sampleRally(rally, t1).puck;
  out.push({ x: end.x, y: end.y, t: t1 });
  return out;
}
