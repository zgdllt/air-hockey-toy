export const INITIAL_ELO = 1000;
export const WIN_RATE_MIN_GAMES = 10;

export function eloResult(a, b, winner) {
  const expected = 1 / (1 + 10 ** ((winner === 0 ? b - a : a - b) / 400));
  const gain = Math.round(32 * (1 - expected));
  const delta = winner === 0 ? gain : -gain;
  return { ratings: [a + delta, b - delta], deltas: [delta, -delta] };
}

export function matchWindow(waitMilliseconds) {
  return waitMilliseconds >= 45000 ? Infinity : 100 + Math.floor(waitMilliseconds / 10000) * 100;
}

export function selectPair(entries, now) {
  const waiting = entries.filter(entry => entry.active && entry.account && !entry.room)
    .sort((a, b) => a.queuedAt - b.queuedAt);
  for (const first of waiting) {
    const candidates = waiting.filter(other => other !== first && other.account.id !== first.account.id
      && Math.abs(other.account.elo - first.account.elo) <= matchWindow(now - Math.min(first.queuedAt, other.queuedAt)))
      .sort((a, b) => Math.abs(a.account.elo - first.account.elo) - Math.abs(b.account.elo - first.account.elo)
        || a.queuedAt - b.queuedAt);
    if (candidates.length) return [first, candidates[0]];
  }
  return null;
}

export function windowKeys(timestamp = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return { all: 'all', day: `day:${day}`, week: `week:${date.toISOString().slice(0, 10)}`, month: `month:${day.slice(0, 7)}` };
}

export function advanceStats(previous, won) {
  const streak = won ? previous.streak + 1 : 0;
  return { games: previous.games + 1, wins: previous.wins + Number(won), streak,
    best_streak: Math.max(previous.best_streak, streak) };
}
