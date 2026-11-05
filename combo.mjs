// A good shot is the same heavy-hit threshold already used by the game's
// "好球！" feedback. The counter survives the opponent's return, but an
// ordinary player hit breaks the chain.
export const GOOD_SHOT_SPEED = 720;

export function advanceGoodShotCombo(current, event) {
  const count = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  if (!event || event.type !== 'hit' || event.side !== 'player') return count;
  const speed = Number(event.speed);
  if (!Number.isFinite(speed) || speed <= GOOD_SHOT_SPEED) return 0;
  return count + 1;
}

export function isCombo(count) {
  return Number.isFinite(count) && count >= 2;
}

// Lift the plastic clack one semitone per combo, up to three semitones.
// The low thump keeps its original pitch in sfx.hit.
export function comboPitch(count) {
  return 2 ** (Math.min(3, Math.max(0, count - 1)) / 12);
}
