import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const nested = new URL('../../web/air-hockey/combo.mjs', import.meta.url);
const { GOOD_SHOT_SPEED, advanceGoodShotCombo, isCombo, comboPitch } = await import(existsSync(nested) ? nested : new URL('../../combo.mjs', import.meta.url));

const heavy = (speed) => ({ type: 'hit', side: 'player', speed });
const opponent = { type: 'hit', side: 'computer', speed: 900 };

assert.equal(advanceGoodShotCombo(0, heavy(GOOD_SHOT_SPEED)), 0, 'threshold matches the existing strict heavy-hit boundary');
assert.equal(advanceGoodShotCombo(0, heavy(GOOD_SHOT_SPEED + 1)), 1);
assert.equal(advanceGoodShotCombo(1, opponent), 1, 'computer returns do not break the player chain');
assert.equal(advanceGoodShotCombo(1, heavy(GOOD_SHOT_SPEED + 100)), 2);
assert.equal(isCombo(1), false);
assert.equal(isCombo(2), true);
assert.equal(advanceGoodShotCombo(2, heavy(500)), 0, 'an ordinary player hit resets combo');
assert.equal(advanceGoodShotCombo(2, heavy(undefined)), 0, 'malformed hit speed cannot create a combo');
assert.equal(advanceGoodShotCombo(99, heavy(900)), 100, 'long rallies keep their actual count');
assert.equal(comboPitch(0), 1);
assert.equal(comboPitch(1), 1);
assert.equal(comboPitch(2), 2 ** (1 / 12));
assert.equal(comboPitch(3), 2 ** (2 / 12));
assert.equal(comboPitch(4), 2 ** (3 / 12));
assert.equal(comboPitch(100), comboPitch(4), 'pitch stays subtle during long combos');
console.log('good-shot combo threshold, persistence and reset rules passed');
