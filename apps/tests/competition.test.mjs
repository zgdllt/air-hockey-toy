// Fake host only: no browser, no external network, no platform writes.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
const nested = new URL('../../web/air-hockey/competition-client.mjs', import.meta.url);
const { createCompetitionClient } = await import(existsSync(nested) ? nested : new URL('../../competition-client.mjs', import.meta.url));

const CLOUD_KEY = 'air_hockey_identity_v1';
const LOCAL_KEY = 'air-hockey-linked-account-v1';
const JOURNAL_KEY = 'air-hockey-practice-journal-v1';
const A = { token: 'A'.repeat(43), profile: { id: 'account-a', alias: 'A', elo: 1000 } };
const B = { token: 'B'.repeat(43), profile: { id: 'account-b', alias: 'B', elo: 1000 } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) { if (predicate()) return; await wait(2); }
  throw new Error('fixture_timeout');
}

function hostFixture(handle, seed = {}) {
  const storage = new Map(Object.entries(seed)), writes = [], reads = [], sockets = [], requests = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const request = JSON.parse(raw); requests.push(request);
      Promise.resolve().then(() => handle(request, this)).then(result => {
        if (!this.closed && result !== undefined) this.onmessage?.({ data: JSON.stringify({ type: 'service.response', requestId: request.requestId, result }) });
      }, error => {
        if (!this.closed) this.onmessage?.({ data: JSON.stringify({ type: 'error', requestId: request.requestId, code: error.message }) });
      });
    }
    close() { if (this.closed) return; this.closed = true; queueMicrotask(() => this.onclose?.()); }
  }
  const host = {
    WebSocket: FakeSocket, crypto: webcrypto,
    setTimeout: (callback, ms) => setTimeout(callback, ms === 30000 ? 100 : ms === 1000 ? 2 : ms === 2000 ? 4 : ms),
    clearTimeout,
    localStorage: {
      getItem(key) { reads.push(key); return storage.get(key) ?? null; },
      setItem(key, value) { writes.push({ key, value }); storage.set(key, value); },
    },
  };
  return { host, storage, writes, reads, sockets, requests };
}
const ordinaryAuth = request => {
  if (request.action === 'account.open') return request.token === B.token ? { profile: B.profile } : request.token ? { profile: A.profile } : A;
  throw new Error(`unexpected:${request.action}`);
};

const passed = [];
{
  const f = hostFixture(ordinaryAuth, { [LOCAL_KEY]: JSON.stringify(B) });
  const cloudCalls = []; let reads = 0;
  const platform = { isToy: () => true, async call(action, ...args) {
    cloudCalls.push({ action, args });
    if (action === 'getCloudStorage') return ++reads === 1 ? {} : { [CLOUD_KEY]: JSON.stringify({ token: B.token }) };
    if (action === 'setCloudStorage') return;
    throw new Error('unexpected platform action');
  } };
  const client = createCompetitionClient({ platform, host: f.host });
  const [one, two] = await Promise.all([client.ensureIdentity(), client.ensureIdentity()]);
  assert.equal(one.token, B.token); assert.equal(two.token, B.token);
  assert.equal(client.state.profile.id, B.profile.id);
  assert.equal(f.requests.filter(request => request.action === 'account.open' && !request.token).length, 1);
  assert.deepEqual(cloudCalls.map(call => call.action), ['getCloudStorage', 'setCloudStorage', 'getCloudStorage']);
  assert(!f.reads.includes(LOCAL_KEY)); assert(!f.writes.some(write => write.key === LOCAL_KEY));
  assert(f.sockets.every(socket => socket.closed));
  passed.push('Toy credential is cloud-only; first write readback wins; concurrent calls share one creation');
}
{
  const f = hostFixture(ordinaryAuth);
  const platform = { isToy: () => true, async call(action) { if (action === 'getCloudStorage') return {}; throw new Error('write_failed_fixture'); } };
  const client = createCompetitionClient({ platform, host: f.host });
  await assert.rejects(client.ensureIdentity(), /write_failed_fixture/);
  assert.equal(client.state.phase, 'unbound'); assert.equal(client.state.profile, null);
  assert(!f.writes.some(write => write.key === LOCAL_KEY));
  passed.push('failed Toy cloud write cannot activate an unsaved credential');
}
{
  let pollCount = 0;
  const f = hostFixture(request => {
    if (request.action === 'link.create') return { code: 'ABCDEF', pollToken: 'poll-secret-fixture', expires: Date.now() + 300000 };
    if (request.action === 'link.poll') {
      assert.equal(request.args.pollToken, 'poll-secret-fixture');
      if (++pollCount > 1) throw new Error('link_expired');
      return { approved: true, token: A.token, profile: A.profile };
    }
    return ordinaryAuth(request);
  });
  const client = createCompetitionClient({ platform: { isToy: () => false }, host: f.host });
  await client.startLink(); await until(() => client.state.phase === 'active'); await wait(20);
  assert.equal(pollCount, 1); assert.equal(JSON.parse(f.storage.get(LOCAL_KEY)).token, A.token);
  assert(f.sockets.every(socket => socket.closed));
  passed.push('non-Toy one-time poll token activates and persists once, without further polling');
}
{
  const old = { matchId: 'a-match', accountId: A.profile.id, difficulty: 'standard', won: true, for: 5, against: 3 };
  const own = { ...old, matchId: 'b-match', accountId: B.profile.id };
  const unassigned = { ...old, matchId: 'unassigned-match', accountId: null };
  const submissions = [];
  const f = hostFixture(request => {
    if (request.action === 'solo.submit') { submissions.push(request); return B.profile; }
    return ordinaryAuth(request);
  }, { [LOCAL_KEY]: JSON.stringify(B), [JOURNAL_KEY]: JSON.stringify([old, own, unassigned]) });
  const client = createCompetitionClient({ platform: { isToy: () => false }, host: f.host });
  await client.flushPractice();
  assert.deepEqual(submissions.map(request => request.args.matchId), ['b-match', 'unassigned-match']);
  assert(submissions.every(request => request.token === B.token && request.args.accountId === B.profile.id));
  assert.deepEqual(JSON.parse(f.storage.get(JOURNAL_KEY)), [old]);
  passed.push('journal uploads only own or unassigned records and preserves another account records');
}
{
  let attempts = 0; const committed = new Set();
  const entry = { matchId: 'retry-match', accountId: A.profile.id, difficulty: 'standard', won: true, for: 5, against: 3 };
  const f = hostFixture((request, socket) => {
    if (request.action === 'solo.submit') {
      committed.add(request.args.matchId);
      if (++attempts === 1) { socket.close(); return; }
      return A.profile;
    }
    return ordinaryAuth(request);
  }, { [LOCAL_KEY]: JSON.stringify(A), [JOURNAL_KEY]: JSON.stringify([entry]) });
  const client = createCompetitionClient({ platform: { isToy: () => false }, host: f.host });
  await assert.rejects(client.flushPractice(), /连接已中断/);
  assert.equal(JSON.parse(f.storage.get(JOURNAL_KEY)).length, 1);
  await client.flushPractice();
  assert.equal(attempts, 2); assert.equal(committed.size, 1);
  assert.deepEqual(JSON.parse(f.storage.get(JOURNAL_KEY)), []);
  assert(f.sockets.every(socket => socket.closed));
  passed.push('lost submit response preserves journal; retry keeps match id for backend idempotency');
}
{
  const f = hostFixture(() => undefined);
  const client = createCompetitionClient({ platform: { isToy: () => false }, host: f.host });
  await assert.rejects(client.board({ mode: 'ranked', metric: 'elo' }), /超时/);
  assert(f.sockets.every(socket => socket.closed));
  passed.push('RPC timeout closes short-lived websocket');
}
for (const elo of [1016, 984]) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let backend = A.profile;
  const entry = { matchId: `stale-profile-${elo}`, accountId: A.profile.id, difficulty: 'standard', won: true, for: 5, against: 3 };
  const f = hostFixture(async request => {
    if (request.action === 'account.open') return { profile: backend };
    if (request.action === 'solo.submit') { await gate; return A.profile; }
    throw new Error('unexpected fixture operation');
  }, { [LOCAL_KEY]: JSON.stringify(A), [JOURNAL_KEY]: JSON.stringify([entry]) });
  const client = createCompetitionClient({ platform: { isToy: () => false }, host: f.host });
  await client.ensureIdentity();
  const saving = client.flushPractice();
  await until(() => f.requests.some(request => request.action === 'solo.submit'));
  backend = { ...A.profile, elo }; client.updateProfile(backend); release();
  await saving;
  assert.equal(client.state.profile.elo, elo, 'delayed practice response cannot overwrite newer winning or losing Elo');
}
passed.push('delayed solo profile cannot undo newer ranked Elo increases or decreases');
console.log(JSON.stringify({ passed }, null, 2));
