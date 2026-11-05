// Independent localhost-only review fixture. No CloudBase calls or credentials.
// Run: node --test online-server/competition-state.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createRoomServer } from './server.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await sleep(5);
  }
  throw new Error('fixture_timeout');
}

async function connection(url) {
  const ws = new WebSocket(url), messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, messages, send: message => ws.send(JSON.stringify(message)) };
}

const tokens = ['A'.repeat(43), 'B'.repeat(43)];
const hashes = tokens.map(token => createHash('sha256').update(token).digest('hex'));
const profiles = tokens.map((_, index) => ({
  id: `${index + 1}`.repeat(8) + '-1111-4111-8111-111111111111',
  alias: `fixture ${index}`, elo: 1000,
}));

async function fixture(hooks = {}) {
  let timestamp = 10000;
  const calls = [], running = new Map();
  const store = {
    async operation(action, payload) {
      calls.push({ action, payload, at: timestamp });
      if (hooks[action]) return hooks[action](payload, { running, profiles, calls });
      if (action === 'auth') return profiles[hashes.indexOf(payload.token_hash)];
      if (action === 'start') {
        if ([...running.values()].some(match => [match.a, match.b].some(id => id === payload.a || id === payload.b))) {
          throw new Error('already_in_match');
        }
        running.set(payload.match_id, payload);
        return { match_id: payload.match_id };
      }
      if (action === 'void') { running.delete(payload.match_id); return {}; }
      if (action === 'finish') {
        running.delete(payload.match_id);
        return { players: profiles.map(profile => ({
          profile: { ...profile, elo: profile.elo + (profile.id === payload.winner ? 16 : -16) },
          delta: profile.id === payload.winner ? 16 : -16,
        })) };
      }
      throw new Error(`unexpected:${action}`);
    },
  };
  const server = createRoomServer({ store, now: () => timestamp });
  const address = await server.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  async function login(index) {
    const client = await connection(url);
    client.send({ type: 'account.login', token: tokens[index] });
    await until(() => client.messages.some(message => message.type === 'account.session'));
    return client;
  }
  async function start() {
    const peers = await Promise.all([login(0), login(1)]);
    peers.forEach((peer, index) => peer.send({ type: 'queue.join', token: tokens[index] }));
    const room = await until(() => [...server.rooms.values()].find(value => value.started));
    return { peers, room };
  }
  return { server, url, login, start, calls, running, advance: ms => timestamp += ms, time: () => timestamp };
}

const passed = [];

{
  const f = await fixture();
  try {
    const client = await connection(f.url);
    for (const raw of ['null', '[]', '42', '"bad"']) client.ws.send(raw);
    await until(() => client.messages.filter(message => message.code === 'invalid_message').length === 4);
    const health = await fetch(f.url.replace('ws:', 'http:').replace('/ws', '/healthz')).then(response => response.json());
    assert.equal(health.ok, true);
    passed.push('null/array/scalar input cannot crash service');
  } finally { await f.server.close(); }
}

{
  let blocked = false, release;
  const gate = new Promise(resolve => release = resolve);
  const f = await fixture({ auth: async payload => {
    if (blocked) await gate;
    return profiles[hashes.indexOf(payload.token_hash)];
  } });
  try {
    const client = await f.login(0);
    blocked = true;
    client.send({ type: 'queue.join', token: tokens[0] });
    await sleep(20);
    client.send({ type: 'queue.cancel' });
    client.send({ type: 'player.active', active: false });
    await until(() => client.messages.some(message => message.type === 'queue.cancelled'));
    release();
    await sleep(80);
    assert.equal(f.server.queue.size, 0);
    assert(!client.messages.some(message => message.type === 'queue.waiting'));
    passed.push('cancel/background during auth invalidates queued join');
  } finally { release(); await f.server.close(); }
}

{
  let failures = 2;
  const f = await fixture({ finish: async (payload, { running }) => {
    if (failures-- > 0) throw new Error('storage_unavailable');
    running.delete(payload.match_id);
    return { players: profiles.map(profile => ({ profile, delta: profile.id === payload.winner ? 16 : -16 })) };
  } });
  try {
    const { peers, room } = await f.start();
    peers[0].send({ type: 'room.leave' });
    await until(() => room.settlementError);
    assert.equal(f.calls.filter(call => call.action === 'finish').length, 1);
    assert.equal(room.retryAt, f.time() + 1000);
    peers[1].send({ type: 'ranked.retry' });
    await until(() => f.calls.filter(call => call.action === 'finish').length === 2 && room.settlementError);
    assert.equal(room.retryAt, f.time() + 2000);
    peers[1].ws.close();
    await until(() => room.clients.length === 0);
    assert.equal(f.server.rooms.size, 1);
    f.advance(15 * 60 * 1000 + 1);
    await until(() => room.ratingResult);
    assert.equal(f.server.rooms.size, 0);
    assert.equal(f.calls.filter(call => call.action === 'finish').length, 3);
    peers[0].send({ type: 'queue.join', token: tokens[0] });
    await until(() => f.server.queue.size === 1);
    passed.push('pending settlement survives empty room/TTL, backs off, manual retry, then frees accounts');
  } finally { await f.server.close(); }
}

{
  let release;
  const gate = new Promise(resolve => release = resolve);
  let failVoid = true;
  const f = await fixture({
    start: async (payload, { running }) => {
      running.set(payload.match_id, payload);
      await gate;
      return { match_id: payload.match_id };
    },
    void: async (payload, { running }) => {
      if (failVoid) throw new Error('storage_unavailable');
      running.delete(payload.match_id);
      return {};
    },
  });
  try {
    const peers = await Promise.all([f.login(0), f.login(1)]);
    peers.forEach((peer, index) => peer.send({ type: 'queue.join', token: tokens[index] }));
    const room = await until(() => [...f.server.rooms.values()].find(value => value.starting));
    peers[0].send({ type: 'room.leave' });
    await until(() => room.clients.length === 1);
    release();
    await until(() => room.voidPending && room.settlementError);
    assert.equal(f.server.rooms.size, 1);
    assert.equal(f.running.size, 1);
    failVoid = false;
    f.advance(1000);
    await until(() => f.server.rooms.size === 0);
    assert.equal(f.running.size, 0);
    assert.equal(f.calls.filter(call => call.action === 'void').length, 2);
    peers[0].send({ type: 'queue.join', token: tokens[0] });
    await until(() => f.server.queue.size === 1);
    passed.push('cancelled persisted start keeps failed void for retry and releases only after success');
  } finally { release(); await f.server.close(); }
}

{
  const f = await fixture();
  try {
    const { peers, room } = await f.start();
    const duplicate = await f.login(0);
    duplicate.send({ type: 'queue.join', token: tokens[0] });
    await until(() => duplicate.messages.some(message => message.code === 'already_in_match'));
    peers[0].ws.close();
    await until(() => room.clients[0].disconnectedAt);
    f.advance(19999);
    duplicate.send({ type: 'ranked.resume' });
    await until(() => duplicate.messages.some(message => message.type === 'room.joined'));
    assert.equal(room.clients[0].slot, 0);
    duplicate.send({ type: 'player.active', active: true });
    await until(() => room.clients.every(client => client.active));
    assert.equal(room.game.phase, 'countdown');
    assert.equal(f.calls.filter(call => call.action === 'finish').length, 0);
    passed.push('duplicate same account excluded; reconnect at 19.999 s preserves slot and resumes');
  } finally { await f.server.close(); }
}

{
  const f = await fixture();
  try {
    const { peers, room } = await f.start();
    peers[0].ws.close();
    await until(() => room.clients[0].disconnectedAt);
    f.advance(20000);
    await until(() => room.ratingResult);
    const finish = f.calls.find(call => call.action === 'finish');
    assert.equal(finish.payload.winner, profiles[1].id);
    assert.equal(finish.payload.reason, 'disconnect');
    passed.push('single disconnect at 20 s loses once');
  } finally { await f.server.close(); }
}

{
  const f = await fixture();
  try {
    const { peers } = await f.start();
    peers.forEach(peer => peer.ws.close());
    await until(() => [...f.server.rooms.values()][0]?.clients.every(client => client.disconnectedAt));
    f.advance(20000);
    await until(() => f.server.rooms.size === 0);
    assert.equal(f.calls.filter(call => call.action === 'finish').length, 0);
    assert.equal(f.calls.filter(call => call.action === 'void').length, 1);
    passed.push('both disconnect voids with no rating settlement');
  } finally { await f.server.close(); }
}

{
  const f = await fixture();
  try {
    const { peers, room } = await f.start();
    peers[0].send({ type: 'player.active', active: false });
    await until(() => !room.clients[0].active);
    const inactiveAt = room.clients[0].inactiveAt;
    f.advance(30000);
    peers[0].send({ type: 'player.active', active: false });
    await sleep(50);
    assert.equal(room.clients[0].inactiveAt, inactiveAt);
    f.advance(30000);
    await until(() => room.ratingResult);
    const finish = f.calls.find(call => call.action === 'finish');
    assert.equal(finish.payload.reason, 'inactive');
    assert.equal(finish.payload.winner, profiles[1].id);
    passed.push('repeated background does not extend 60 s deadline');
  } finally { await f.server.close(); }
}

console.log(JSON.stringify({ passed }, null, 2));
