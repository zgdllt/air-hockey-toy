import test from 'node:test';
import assert from 'node:assert/strict';
import { eloResult, selectPair, matchWindow, advanceStats, windowKeys } from './competition-rules.mjs';

test('Elo rewards upsets, is symmetric, and conserves both players total', () => {
  assert.deepEqual(eloResult(1000, 1000, 0), { ratings: [1016, 984], deltas: [16, -16] });
  assert.deepEqual(eloResult(1000, 1400, 0).deltas, [29, -29]);
  assert.deepEqual(eloResult(1400, 1000, 1).ratings, [1371, 1029]);
  for (const a of [-500, 1000, 3000]) for (const b of [-500, 1000, 3000]) {
    for (const winner of [0, 1]) assert.equal(eloResult(a, b, winner).ratings.reduce((x, y) => x + y), a + b);
  }
});

test('matching picks nearby peers, excludes self, widens and can wait with nobody', () => {
  const entry = (id, elo) => ({ account: { id, elo }, active: true, queuedAt: 0 });
  const a = entry('a', 1000), b = entry('b', 1090), c = entry('c', 1020);
  assert.deepEqual(selectPair([a, b, c], 0), [a, c]);
  assert.equal(selectPair([a, entry('a', 1000)], 100000), null);
  assert.equal(selectPair([a, entry('b', 1500)], 0), null);
  assert(selectPair([a, entry('b', 1500)], 45000));
  assert.equal(selectPair([a], 100000), null);
  assert.equal(matchWindow(45000), Infinity);
});

test('practice streak breaks while peak survives; wins and rate can decrease', () => {
  let stats = { games: 0, wins: 0, streak: 0, best_streak: 0 };
  for (const won of [true, true, false, true]) stats = advanceStats(stats, won);
  assert.deepEqual(stats, { games: 4, wins: 3, streak: 1, best_streak: 2 });
  assert.equal(advanceStats(stats, false).wins / 5, .6);
});

test('period windows use Shanghai midnight and Monday week boundaries', () => {
  assert.deepEqual(windowKeys(Date.parse('2026-11-01T16:00:00Z')), {
    all: 'all', day: 'day:2026-11-02', week: 'week:2026-11-02', month: 'month:2026-11',
  });
});
