// A self-contained arcade model. Units are rink pixels and simulation seconds.
// This intentionally does not reproduce the project's MuJoCo benchmark.
const RINK = Object.freeze({ width: 1000, height: 560, goalHalf: 100,
  puckRadius: 16, malletRadius: 37, postRadius: 8, winningScore: 5 });

const LEVELS = Object.freeze({
  warmup: { label: '热身', speed: 510, reaction: 0.15, error: 38 },
  standard: { label: '标准', speed: 740, reaction: 0.09, error: 21 },
  challenge: { label: '挑战', speed: 980, reaction: 0.055, error: 8 },
});

const STEP = 1 / 240;
const PLAYER_FOLLOW_RATE = 55; // Fast arcade response; unlike the robot servo, this is input feel.
const PLAYER_SWEEP_SPEED = 7200; // Position sweep cap; keeps a discrete step from skipping contact.
const PLAYER_IMPACT_SPEED = 3600; // Keep cursor jumps from creating infinite hit impulse.
const OPPONENT_FOLLOW_RATE = 55;
const OPPONENT_SWEEP_SPEED = 7200;
const OPPONENT_IMPACT_SPEED = 3600;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function move(body, target, speed, dt) {
  const dx = target.x - body.x, dy = target.y - body.y;
  const distance = Math.hypot(dx, dy);
  const amount = distance > 0 ? Math.min(1, speed * dt / distance) : 0;
  body.vx = dx * amount / dt;
  body.vy = dy * amount / dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}

class AirHockey {
  constructor({ difficulty = 'standard', random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.difficulty = LEVELS[difficulty] ? difficulty : 'standard';
    this.reset();
  }

  reset() {
    this.phase = 'ready';
    this.pausedFrom = null;
    this.score = { player: 0, computer: 0 };
    this.stats = { time: 0, playerHits: 0, longestRally: 0, fastestShot: 0 };
    this.rally = 0;
    this.serveTo = 'player';
    this.timer = 0;
    this.accumulator = 0;
    this.lastScorer = null;
    this.multiplayer = false;
    this.resetPositions();
  }

  resetPositions() {
    this.player = { x: 145, y: 280, vx: 0, vy: 0 };
    this.computer = { x: 855, y: 280, vx: 0, vy: 0 };
    this.puck = { x: 500, y: 280, vx: 0, vy: 0 };
    this.target = { x: 145, y: 280 };
    this.aiTarget = { x: 855, y: 280 };
    this.aiTimer = 0;
    this.contacts = new Set();
    this.rally = 0;
  }

  start(difficulty = this.difficulty) {
    this.difficulty = LEVELS[difficulty] ? difficulty : 'standard';
    this.reset();
    this.phase = 'countdown';
    this.timer = 2.4;
    this.onEvent({ type: 'start' });
  }

  setTarget(x, y) {
    const r = RINK.malletRadius;
    this.target.x = clamp(x, r + 5, RINK.width / 2 - r - 8);
    this.target.y = clamp(y, r + 5, RINK.height - r - 5);
  }

  setOpponentTarget(x, y) {
    const r = RINK.malletRadius;
    this.aiTarget.x = clamp(x, RINK.width / 2 + r + 8, RINK.width - r - 5);
    this.aiTarget.y = clamp(y, r + 5, RINK.height - r - 5);
  }

  setMultiplayer(enabled = true) {
    this.multiplayer = Boolean(enabled);
  }

  followPlayer(dt) {
    const previousX = this.player.x, previousY = this.player.y;
    const amount = 1 - Math.exp(-PLAYER_FOLLOW_RATE * dt);
    let deltaX = (this.target.x - this.player.x) * amount;
    let deltaY = (this.target.y - this.player.y) * amount;
    // A discrete collision step must not sweep the mallet through the puck.
    // The puck can move at most ~8 px per 240 Hz step, so this 30 px cap keeps
    // the combined relative travel below the 106 px contact diameter.
    const deltaLength = Math.hypot(deltaX, deltaY);
    const maxDelta = PLAYER_SWEEP_SPEED * dt;
    if (deltaLength > maxDelta) {
      const scale = maxDelta / deltaLength;
      deltaX *= scale;
      deltaY *= scale;
    }
    this.player.x += deltaX;
    this.player.y += deltaY;
    // Keep visual following responsive while bounding the velocity used for
    // collision impulse. Pointer jumps must not become infinite power shots.
    this.player.vx = clamp((this.player.x - previousX) / dt, -PLAYER_IMPACT_SPEED, PLAYER_IMPACT_SPEED);
    this.player.vy = clamp((this.player.y - previousY) / dt, -PLAYER_IMPACT_SPEED, PLAYER_IMPACT_SPEED);
  }

  followOpponent(dt) {
    const previousX = this.computer.x, previousY = this.computer.y;
    const amount = 1 - Math.exp(-OPPONENT_FOLLOW_RATE * dt);
    let deltaX = (this.aiTarget.x - this.computer.x) * amount;
    let deltaY = (this.aiTarget.y - this.computer.y) * amount;
    const deltaLength = Math.hypot(deltaX, deltaY);
    const maxDelta = OPPONENT_SWEEP_SPEED * dt;
    if (deltaLength > maxDelta) {
      const scale = maxDelta / deltaLength;
      deltaX *= scale;
      deltaY *= scale;
    }
    this.computer.x += deltaX;
    this.computer.y += deltaY;
    this.computer.vx = clamp((this.computer.x - previousX) / dt, -OPPONENT_IMPACT_SPEED, OPPONENT_IMPACT_SPEED);
    this.computer.vy = clamp((this.computer.y - previousY) / dt, -OPPONENT_IMPACT_SPEED, OPPONENT_IMPACT_SPEED);
  }

  pause() {
    if (!['playing', 'countdown', 'goal'].includes(this.phase)) return;
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    this.accumulator = 0;
    this.onEvent({ type: 'pause' });
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = this.pausedFrom;
    this.pausedFrom = null;
    this.onEvent({ type: 'resume' });
  }

  serve() {
    this.phase = 'playing';
    const direction = this.serveTo === 'player' ? -1 : 1;
    this.puck.vx = direction * 360;
    this.puck.vy = (this.random() - 0.5) * 160;
    this.onEvent({ type: 'serve' });
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || ['ready', 'paused', 'finished'].includes(this.phase)) return;
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.step(STEP);
      if (this.phase === 'finished') { this.accumulator = 0; break; }
    }
  }

  step(dt) {
    if (this.phase === 'countdown' || this.phase === 'goal') {
      this.timer -= dt;
      if (this.phase === 'countdown') this.followPlayer(dt);
      if (this.phase === 'countdown' && this.multiplayer) this.followOpponent(dt);
      if (this.timer <= 0) {
        if (this.phase === 'goal') {
          this.resetPositions();
          this.phase = 'countdown';
          this.timer = 1.4;
        } else this.serve();
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.stats.time += dt;
    if (this.multiplayer) this.followOpponent(dt);
    else this.think(dt);
    this.followPlayer(dt);
    if (!this.multiplayer) move(this.computer, this.aiTarget, LEVELS[this.difficulty].speed, dt);
    const p = this.puck;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const drag = Math.exp(-0.075 * dt);
    p.vx *= drag; p.vy *= drag;
    this.collideMallet(this.player, 'player');
    this.collideMallet(this.computer, 'computer');
    this.collideRink();
    if (p.x < -RINK.puckRadius) this.goal('computer');
    else if (p.x > RINK.width + RINK.puckRadius) this.goal('player');
    else if (Math.hypot(p.vx, p.vy) < 32) {
      this.slowTime = (this.slowTime || 0) + dt;
      if (this.slowTime > 2.5) {
        this.serveTo = p.x < 500 ? 'player' : 'computer';
        this.resetPositions();
        this.phase = 'countdown'; this.timer = 1.4;
        this.slowTime = 0;
        this.onEvent({ type: 'deadball' });
      }
    } else this.slowTime = 0;
  }

  think(dt) {
    this.aiTimer -= dt;
    if (this.aiTimer > 0) return;
    const level = LEVELS[this.difficulty], p = this.puck;
    this.aiTimer = level.reaction;
    const jitter = (this.random() - 0.5) * level.error * 2;
    let x = 850, y = 280 + (p.y - 280) * 0.45;
    if (p.vx > 0) {
      x = clamp(p.x + 100, 640, 875);
      const travel = Math.max(0, (x - p.x) / p.vx);
      const span = RINK.height - RINK.puckRadius * 2;
      const unfolded = p.y - RINK.puckRadius + p.vy * travel;
      const folded = ((unfolded % (span * 2)) + span * 2) % (span * 2);
      y = RINK.puckRadius + (folded > span ? span * 2 - folded : folded);
    }
    if (p.x > 570) {
      y = p.y + jitter;
      const aligned = Math.abs(this.computer.y - p.y) < 48;
      x = aligned ? p.x - 65 : p.x + 88;
    }
    const r = RINK.malletRadius;
    this.aiTarget = { x: clamp(x, 500 + r + 8, 1000 - r - 5),
      y: clamp(y + jitter, r + 5, 560 - r - 5) };
  }

  collideMallet(mallet, side) {
    const p = this.puck;
    const dx = p.x - mallet.x, dy = p.y - mallet.y;
    const distance = Math.hypot(dx, dy);
    const radius = RINK.puckRadius + RINK.malletRadius;
    if (distance > radius + 2) this.contacts.delete(side);
    if (distance >= radius) return;
    const nx = distance > 0.0001 ? dx / distance : (side === 'player' ? 1 : -1);
    const ny = distance > 0.0001 ? dy / distance : 0;
    p.x = mallet.x + nx * (radius + 0.05);
    p.y = mallet.y + ny * (radius + 0.05);
    const incoming = (p.vx - mallet.vx) * nx + (p.vy - mallet.vy) * ny;
    if (incoming >= 0) return;
    p.vx -= 1.9 * incoming * nx;
    p.vy -= 1.9 * incoming * ny;
    const speed = Math.hypot(p.vx, p.vy);
    const capped = Math.min(speed, 1850);
    if (speed > 1850) { p.vx *= capped / speed; p.vy *= capped / speed; }
    if (!this.contacts.has(side)) {
      this.contacts.add(side);
      this.rally += 1;
      this.stats.longestRally = Math.max(this.stats.longestRally, this.rally);
      if (side === 'player') {
        this.stats.playerHits += 1;
        this.stats.fastestShot = Math.max(this.stats.fastestShot, capped);
      }
      this.onEvent({ type: 'hit', side, x: p.x, y: p.y, speed: capped });
    }
  }

  collideRink() {
    const p = this.puck, r = RINK.puckRadius;
    if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy) * 0.96; this.wall(); }
    if (p.y > 560 - r) { p.y = 560 - r; p.vy = -Math.abs(p.vy) * 0.96; this.wall(); }
    const outsideMouth = Math.abs(p.y - 280) >= RINK.goalHalf;
    if (outsideMouth && p.x < r) { p.x = r; p.vx = Math.abs(p.vx) * 0.96; this.wall(); }
    if (outsideMouth && p.x > 1000 - r) { p.x = 1000 - r; p.vx = -Math.abs(p.vx) * 0.96; this.wall(); }
    for (const x of [0, 1000]) for (const y of [180, 380]) {
      const dx = p.x - x, dy = p.y - y, distance = Math.hypot(dx, dy);
      const radius = r + RINK.postRadius;
      if (distance >= radius) continue;
      const nx = distance > 0.0001 ? dx / distance : (x === 0 ? 1 : -1);
      const ny = distance > 0.0001 ? dy / distance : 0;
      p.x = x + nx * (radius + 0.05); p.y = y + ny * (radius + 0.05);
      const speed = p.vx * nx + p.vy * ny;
      if (speed < 0) { p.vx -= 1.96 * speed * nx; p.vy -= 1.96 * speed * ny; this.wall(); }
    }
  }

  wall() { this.onEvent({ type: 'wall', x: this.puck.x, y: this.puck.y }); }

  goal(side) {
    this.score[side] += 1;
    this.lastScorer = side;
    this.puck.vx = 0; this.puck.vy = 0;
    this.slowTime = 0;
    if (this.score[side] >= RINK.winningScore) {
      this.phase = 'finished';
      this.onEvent({ type: 'finish', winner: side });
    } else {
      this.phase = 'goal'; this.timer = 1.6;
      this.serveTo = side === 'player' ? 'computer' : 'player';
      this.onEvent({ type: 'goal', side });
    }
  }
}


if (typeof module !== 'undefined') module.exports = { AirHockey, LEVELS, RINK };
