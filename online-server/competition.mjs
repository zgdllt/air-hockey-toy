import { createHash, randomBytes, randomUUID } from 'node:crypto';

const DIFFICULTIES = ['warmup', 'standard', 'challenge'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export function createCompetition({ store, now = Date.now } = {}) {
  const links = new Map();
  async function operation(action, payload) {
    if (!store) throw new Error('competition_unavailable');
    return store.operation(action, payload);
  }
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid_account');
    return operation('auth', { token_hash: digest(token) });
  }
  function sweepLinks() {
    for (const [code, value] of links) if (value.expires <= now()) links.delete(code);
  }
  function link(code) {
    sweepLinks();
    const value = links.get(code);
    if (!value) throw new Error('link_expired');
    return value;
  }
  return {
    available: Boolean(store), authenticate,
    recover: () => operation('recover', {}),
    start: (matchId, a, b) => operation('start', { match_id: matchId, a, b }),
    void: matchId => operation('void', { match_id: matchId }),
    finish: (matchId, winner, reason) => operation('finish', { match_id: matchId, winner, reason }),
    async request(message) {
      const { action, token, args = {} } = message;
      if (!store) throw new Error('competition_unavailable');
      if (action === 'account.open') {
        if (token) return { profile: await authenticate(token) };
        const issued = secret();
        const id = randomUUID();
        // Public names are generated here; arbitrary client text is never published.
        const adjectives = ['薄荷', '晴空', '柠檬', '海盐', '橘子', '星光'];
        const animals = ['海獭', '企鹅', '水豚', '小熊', '鲸鱼', '松鼠'];
        const bytes = randomBytes(2);
        const alias = `${adjectives[bytes[0] % adjectives.length]}${animals[bytes[1] % animals.length]} · ${id.slice(0, 4).toUpperCase()}`;
        return { token: issued, profile: await operation('register', { id, alias, token_hash: digest(issued) }) };
      }
      if (action === 'board.list') {
        const { mode, metric, difficulty = 'standard', period = 'all' } = args;
        if (!['solo', 'ranked'].includes(mode) || !['streak', 'rate', 'wins', 'elo'].includes(metric)
          || !DIFFICULTIES.includes(difficulty) || !['all', 'day', 'week', 'month'].includes(period)
          || (mode === 'solo' && metric === 'elo')) throw new Error('invalid_board');
        const account = token ? await authenticate(token) : null;
        return operation('board', { mode, metric, difficulty, period, player_id: account?.id });
      }
      if (action === 'solo.submit') {
        const account = await authenticate(token);
        if (!UUID.test(args.matchId || '') || !DIFFICULTIES.includes(args.difficulty)
          || typeof args.won !== 'boolean' || !Number.isInteger(args.for) || !Number.isInteger(args.against)
          || Math.min(args.for, args.against) < 0 || Math.max(args.for, args.against) !== 5
          || Math.min(args.for, args.against) >= 5 || args.won !== (args.for === 5)) throw new Error('invalid_result');
        return operation('solo', { player_id: account.id, match_id: args.matchId, difficulty: args.difficulty,
          won: args.won, score_for: args.for, score_against: args.against, source: 'client_practice' });
      }
      if (action === 'link.create') {
        sweepLinks();
        let code;
        do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (links.has(code));
        const pollToken = secret(), expires = now() + 5 * 60 * 1000;
        links.set(code, { pollHash: digest(pollToken), expires, token: null });
        return { code, pollToken, expires };
      }
      if (action === 'link.approve') {
        const account = await authenticate(token);
        const value = link(String(args.code || '').toUpperCase());
        if (value.token && value.token !== token) throw new Error('link_claimed');
        value.token = token;
        return { profile: account };
      }
      if (action === 'link.poll') {
        const code = String(args.code || '').toUpperCase();
        const value = link(code);
        if (typeof args.pollToken !== 'string' || digest(args.pollToken) !== value.pollHash) throw new Error('invalid_link');
        if (!value.token) return { approved: false };
        links.delete(code);
        return { approved: true, token: value.token, profile: await authenticate(value.token) };
      }
      throw new Error('unknown_operation');
    },
  };
}
