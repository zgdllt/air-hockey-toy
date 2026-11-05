import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createCompetition } from './competition.mjs';
import { selectPair } from './competition-rules.mjs';

const require = createRequire(import.meta.url);
const { AirHockey } = require('./physics.cjs');

const TICK_HZ = 30;
const MAX_ROOMS = 1000;
const ROOM_TTL_MS = 15 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function createRoomServer({ store = null, now = Date.now, disconnectGrace = 20000, inactiveGrace = 60000 } = {}) {
const rooms = new Map();
const queue = new Set();
const rankedAccounts = new Map();
const competition = createCompetition({ store, now });
let pairing = false, shuttingDown = false;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'yi-peng-air-online', rooms: rooms.size, competition: competition.available });
  return json(res, 404, { ok: false, error: 'not_found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
httpServer.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url || '/', 'http://localhost'); }
  catch { socket.destroy(); return; }
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function newCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('room_capacity');
}

function send(client, message) {
  // Several seconds of stale snapshots are no longer playable. Bound the queue
  // rather than retaining an ever-growing backlog for a slow connection.
  if (client.ws.bufferedAmount > 128 * 1024) { client.ws.terminate(); return; }
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const client of room.clients) send(client, message);
}

function roomState(room) {
  return {
    code: room.code,
    phase: room.game.phase,
    players: room.clients.map((client) => ({ slot: client.slot, ready: client.ready, active: client.active,
      connected: !client.disconnectedAt, ...(room.ranked ? { alias: client.account.alias, elo: client.account.elo } : {}) })),
    maxPlayers: 2,
    tick: room.tick,
    started: room.started,
    ranked: room.ranked,
    settling: Boolean(room.settling || room.voiding || room.starting),
    voidPending: room.voidPending || false,
    settlementError: room.settlementError || false,
    resultWinner: room.resolution?.slot,
    finishReason: room.resolution?.reason,
  };
}

function snapshot(room) {
  const game = room.game;
  return {
    type: 'snapshot',
    tick: room.tick,
    phase: game.phase,
    score: game.score,
    serveTo: game.serveTo,
    lastScorer: game.lastScorer,
    rally: game.rally,
    stats: { ...game.stats, players: room.playerStats },
    timer: game.timer,
    puck: { x: game.puck.x, y: game.puck.y, vx: game.puck.vx, vy: game.puck.vy },
    players: {
      0: { x: game.player.x, y: game.player.y, vx: game.player.vx, vy: game.player.vy },
      1: { x: game.computer.x, y: game.computer.y, vx: game.computer.vx, vy: game.computer.vy },
    },
  };
}

function createRoom(ranked = false) {
  if (rooms.size >= MAX_ROOMS) throw new Error('room_capacity');
  const code = newCode();
  const room = {
    code,
    ranked,
    tick: 0,
    lastActive: now(),
    started: false,
    clients: [],
    events: [],
    playerStats: [{ playerHits: 0, fastestShot: 0 }, { playerHits: 0, fastestShot: 0 }],
    game: new AirHockey({ difficulty: 'standard', random: Math.random, onEvent: (event) => room.events.push(event) }),
  };
  rooms.set(code, room);
  return room;
}

function dequeue(client) {
  client.queueEpoch = (client.queueEpoch || 0) + 1;
  const cancelled = queue.delete(client) || client.queueJoining;
  client.queueJoining = false;
  if (cancelled) send(client, { type: 'queue.cancelled' });
}

function dropRankedReservation(room) {
  for (const id of room.reservedIds || []) if (rankedAccounts.get(id) === room) rankedAccounts.delete(id);
}

function cancelRankedRoom(room) {
  dropRankedReservation(room);
  for (const peer of room.clients) {
    send(peer, { type: 'ranked.cancelled' });
    if (peer.room === room) peer.room = null;
  }
  room.clients = []; rooms.delete(room.code);
}

function scheduleSettlementRetry(room) {
  room.settlementError = true;
  room.retryAt = now() + Math.min(60000, 1000 * 2 ** Math.min(room.settlementAttempts || 0, 6));
  room.settlementAttempts = (room.settlementAttempts || 0) + 1;
}

async function settleRanked(room, slot, reason) {
  if (room.settling || room.ratingResult) return;
  if (!room.resolution) room.resolution = { slot, reason };
  room.started = false; room.settling = true; room.settlementError = false;
  if (room.game.phase !== 'finished') {
    room.game.phase = 'finished'; room.game.timer = 0;
    broadcast(room, { type: 'match.finish', event: { type: 'finish', winner: slot === 0 ? 'player' : 'computer' }, tick: room.tick });
    broadcast(room, snapshot(room));
  }
  broadcast(room, { type: 'room.state', state: roomState(room) });
  try {
    const winner = room.competitors[room.resolution.slot];
    const result = await competition.finish(room.matchId, winner.id, room.resolution.reason);
    room.ratingResult = result;
    for (const client of room.clients) {
      const entry = result.players.find(player => player.profile.id === client.account.id);
      if (entry) client.account = entry.profile;
      send(client, { type: 'ranked.result', result: entry, reason: room.resolution.reason });
    }
    dropRankedReservation(room);
  } catch {
    scheduleSettlementRetry(room);
  } finally {
    room.settling = false;
    broadcast(room, { type: 'room.state', state: roomState(room) });
    if (room.ratingResult && !room.clients.length) rooms.delete(room.code);
  }
}

async function voidRanked(room) {
  if (room.settling || room.ratingResult || room.voiding) return;
  room.voiding = true; room.settlementError = false; room.started = false; room.game.phase = 'finished';
  room.voidPending = true;
  try {
    await competition.void(room.matchId);
    cancelRankedRoom(room);
  } catch { scheduleSettlementRetry(room); }
  finally { room.voiding = false; broadcast(room, { type: 'room.state', state: roomState(room) }); }
}

function removeClient(client, deliberate = false) {
  dequeue(client);
  const room = client.room;
  if (!room || !room.clients.includes(client)) return;
  if (room.ranked && !shuttingDown && room.started && !deliberate) {
    if (client.disconnectedAt) return;
    client.active = false; client.disconnectedAt = now();
    room.game.pause();
    broadcast(room, { type: 'room.state', state: roomState(room) });
    return;
  }
  if (room.ranked && room.started && deliberate && !shuttingDown) void settleRanked(room, 1 - client.slot, 'leave');
  room.clients = room.clients.filter((candidate) => candidate !== client);
  room.lastActive = now();
  if (room.ranked) {
    client.room = null;
    broadcast(room, { type: 'room.state', state: roomState(room) });
    if (!room.clients.length && !room.starting && !room.settling && !room.voidPending && !(room.resolution && !room.ratingResult)) {
      dropRankedReservation(room); rooms.delete(room.code);
    }
    return;
  }
  room.started = false;
  room.game.reset();
  room.events.length = 0;
  room.clients.forEach(peer => { peer.ready = false; });
  broadcast(room, { type: 'room.peer_left', slot: client.slot, state: roomState(room) });
  client.room = null;
  if (room.clients.length === 0) rooms.delete(room.code);
}

async function startIfReady(room) {
  if (room.clients.length !== 2 || !room.clients.every((client) => client.ready && client.active) || room.started || room.starting) return;
  if (room.ranked) {
    room.starting = true; room.matchId = randomUUID();
    const competitors = [...room.clients].sort((a, b) => a.slot - b.slot).map(client => client.account);
    room.competitors = competitors;
    try {
      await competition.start(room.matchId, competitors[0].id, competitors[1].id);
      if (room.clients.length !== 2 || room.clients.some(client => client.ws.readyState !== WebSocket.OPEN || !client.active)) {
        await voidRanked(room); return;
      }
    } catch {
      await voidRanked(room);
      return;
    } finally { room.starting = false; }
  }
  room.started = true;
  room.playerStats = [{ playerHits: 0, fastestShot: 0 }, { playerHits: 0, fastestShot: 0 }];
  room.game.start('standard');
  room.game.setMultiplayer(true);
  broadcast(room, { type: 'match.start', state: roomState(room) });
}

function joinRoom(client, room) {
  if (client.room) throw new Error('already_in_room');
  if (!room || room.clients.length >= 2) throw new Error('room_full');
  client.room = room;
  client.slot = room.clients.some(peer => peer.slot === 0) ? 1 : 0;
  client.lastSeq = -1;
  client.ready = false;
  client.active = true;
  room.clients.push(client);
  room.lastActive = now();
  send(client, { type: 'room.joined', slot: client.slot, state: roomState(room) });
  send(client, snapshot(room));
  broadcast(room, { type: 'room.state', state: roomState(room) });
}

async function handleMessage(client, message) {
  if (!message || typeof message.type !== 'string') throw new Error('invalid_message');
  client.lastMessage = now();
  if (message.type === 'service.request') {
    const result = await competition.request(message);
    send(client, { type: 'service.response', requestId: message.requestId, result });
    return;
  }
  if (message.type === 'account.login') {
    if (client.room || queue.has(client)) throw new Error('already_in_room');
    client.account = await competition.authenticate(message.token);
    send(client, { type: 'account.session', profile: client.account, requestId: message.requestId });
    return;
  }
  if (message.type === 'queue.cancel') { dequeue(client); return; }
  if (message.type === 'queue.join') {
    if (!client.account) throw new Error('account_required');
    if (client.room) throw new Error('already_in_room');
    if (!client.active) throw new Error('inactive');
    if (rankedAccounts.has(client.account.id) || [...queue].some(peer => peer !== client && peer.account.id === client.account.id)) throw new Error('already_in_match');
    const epoch = client.queueEpoch = (client.queueEpoch || 0) + 1;
    client.queueJoining = true;
    try {
      const account = await competition.authenticate(message.token);
      if (client.queueEpoch !== epoch || !client.active || client.room || client.ws.readyState !== WebSocket.OPEN) return;
      client.account = account;
      if (rankedAccounts.has(account.id) || [...queue].some(peer => peer !== client && peer.account.id === account.id)) throw new Error('already_in_match');
      client.queuedAt = now(); queue.add(client);
      send(client, { type: 'queue.waiting', queuedAt: client.queuedAt, requestId: message.requestId });
    } finally { if (client.queueEpoch === epoch) client.queueJoining = false; }
    return;
  }
  if (message.type === 'ranked.resume') {
    if (client.room || queue.has(client)) throw new Error('already_in_room');
    if (!client.account) throw new Error('account_required');
    const room = rankedAccounts.get(client.account.id);
    const previous = room?.clients.find(peer => peer.account.id === client.account.id);
    if (!previous || !previous.disconnectedAt || now() - previous.disconnectedAt >= disconnectGrace) throw new Error('match_expired');
    room.clients[room.clients.indexOf(previous)] = client;
    client.room = room; client.slot = previous.slot; client.active = false; client.inactiveAt = previous.disconnectedAt;
    client.ready = true; client.lastSeq = -1; previous.room = null;
    send(client, { type: 'room.joined', slot: client.slot, state: roomState(room), requestId: message.requestId });
    send(client, snapshot(room)); broadcast(room, { type: 'room.state', state: roomState(room) });
    return;
  }
  if (message.type === 'player.active' && !client.room) {
    client.active = Boolean(message.active); if (!client.active) dequeue(client); return;
  }
  if (message.type === 'hello') {
    // Production must validate a server-issued token produced after wx.login.
    // No AppSecret belongs in this process's client-facing source.
    client.session = typeof message.session === 'string' ? message.session.slice(0, 256) : null;
    send(client, { type: 'hello.ok', protocol: 1, serverTime: now() });
    return;
  }
  if (message.type === 'room.create') {
    if (client.room) throw new Error('already_in_room');
    dequeue(client);
    joinRoom(client, createRoom());
    return;
  }
  if (message.type === 'room.join') {
    const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (rooms.get(code)?.ranked) throw new Error('ranked_private');
    dequeue(client);
    joinRoom(client, rooms.get(code));
    return;
  }
  if (!client.room) throw new Error('not_in_room');
  const room = client.room;
  room.lastActive = now();
  if (message.type === 'ranked.retry') {
    if (room.ranked && room.settlementError) {
      if (room.voidPending) await voidRanked(room);
      else if (room.resolution) await settleRanked(room, room.resolution.slot, room.resolution.reason);
    }
    return;
  }
  if (message.type === 'player.active') {
    const active = Boolean(message.active);
    if (!active && client.active) client.inactiveAt = now();
    client.active = active;
    if (active) client.inactiveAt = null;
    if (room.started) {
      if (room.clients.some(peer => !peer.active)) room.game.pause();
      else room.game.resume();
    }
    broadcast(room, { type: 'room.state', state: roomState(room) });
    return;
  }
  if (message.type === 'player.ready') {
    if (room.ranked) throw new Error('use_matchmaking');
    client.ready = Boolean(message.ready);
    client.active = true;
    broadcast(room, { type: 'room.state', state: roomState(room) });
    void startIfReady(room);
    return;
  }
  if (message.type === 'input') {
    if (!room.started || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
    if (!Number.isSafeInteger(message.seq) || message.seq <= client.lastSeq) return;
    const x = Number(message.x), y = Number(message.y);
    if (client.slot === 0) room.game.setTarget(x, y);
    else room.game.setOpponentTarget(x, y);
    client.lastSeq = message.seq;
    return;
  }
  if (message.type === 'room.leave') {
    removeClient(client, true);
    send(client, { type: 'room.left' });
    return;
  }
  throw new Error('unknown_message');
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const client = { ws, room: null, slot: -1, ready: false, active: true, session: null, lastMessage: now(), lastSeq: -1 };
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid_message');
      const asynchronous = ['service.request', 'account.login', 'queue.join', 'ranked.resume', 'ranked.retry'].includes(message?.type);
      if (asynchronous && client.busy) throw new Error('busy');
      if (asynchronous) client.busy = true;
      void handleMessage(client, message).catch(error => send(client, { type: 'error', requestId: message?.requestId, code: safeError(error) }))
        .finally(() => { if (asynchronous) client.busy = false; });
    } catch (error) { send(client, { type: 'error', requestId: message?.requestId, code: safeError(error) }); }
  });
  ws.on('close', () => removeClient(client));
  ws.on('error', () => removeClient(client));
  send(client, { type: 'connected', protocol: 1 });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);

function safeError(error) {
  const allowed = ['competition_unavailable', 'storage_unavailable', 'invalid_account', 'invalid_board', 'invalid_result', 'invalid_match',
    'invalid_link', 'link_expired', 'link_claimed', 'result_conflict', 'same_player', 'already_in_match', 'account_required', 'match_expired',
    'ranked_private', 'use_matchmaking', 'already_in_room', 'room_full', 'room_expired', 'room_capacity', 'not_in_room', 'unknown_message', 'inactive', 'busy'];
  return allowed.includes(error?.message) ? error.message : 'invalid_message';
}

const matchmaking = setInterval(() => {
  if (pairing || shuttingDown || rooms.size >= MAX_ROOMS) return;
  const pair = selectPair([...queue], now());
  if (!pair) return;
  pairing = true;
  const room = createRoom(true);
  room.reservedIds = pair.map(client => client.account.id);
  for (const client of pair) {
    queue.delete(client); rankedAccounts.set(client.account.id, room); joinRoom(client, room); client.ready = true;
  }
  void startIfReady(room).finally(() => { pairing = false; });
}, 500);

const timer = setInterval(() => {
  const dt = 1 / TICK_HZ;
  const timestamp = now();
  for (const [code, room] of rooms) {
    if (room.ranked && room.settlementError && timestamp >= room.retryAt) {
      if (room.voidPending) void voidRanked(room);
      else if (room.resolution) void settleRanked(room, room.resolution.slot, room.resolution.reason);
    }
    if (room.ranked && (room.starting || room.settling || room.voidPending || (room.resolution && !room.ratingResult))) continue;
    if (room.ranked && room.started) {
      const missing = room.clients.filter(client => client.disconnectedAt || !client.active);
      const expired = missing.find(client => client.disconnectedAt
        ? timestamp - client.disconnectedAt >= disconnectGrace : timestamp - client.inactiveAt >= inactiveGrace);
      if (expired) {
        if (missing.length === 2) void voidRanked(room);
        else void settleRanked(room, 1 - expired.slot, expired.disconnectedAt ? 'disconnect' : 'inactive');
        continue;
      }
    }
    if (room.clients.length === 0 || timestamp - room.lastActive > ROOM_TTL_MS) {
      if (room.ranked && room.started) { void voidRanked(room); continue; }
      for (const client of room.clients) { send(client, { type: 'error', code: 'room_expired' }); client.room = null; }
      rooms.delete(code); continue;
    }
    if (room.started && room.game.phase !== 'finished') {
      room.tick += 1;
      room.game.update(dt);
      for (const event of room.events.splice(0)) {
        if (event.type === 'hit') {
          const stats = room.playerStats[event.side === 'player' ? 0 : 1];
          stats.playerHits += 1; stats.fastestShot = Math.max(stats.fastestShot, event.speed);
        }
        const type = event.type === 'finish' ? 'match.finish' : event.type;
        broadcast(room, { type, event, tick: room.tick });
      }
      broadcast(room, snapshot(room));
      if (room.game.phase === 'finished') {
        if (room.ranked) {
          const slot = room.game.score.player >= 5 ? 0 : 1;
          void settleRanked(room, slot, 'score');
        }
        room.started = false; room.clients.forEach(client => { client.ready = false; });
        broadcast(room, { type: 'room.state', state: roomState(room) });
      }
    }
  }
}, 1000 / TICK_HZ);

return {
  rooms, queue, competition,
  listen(port = 0, host = '127.0.0.1') {
    return new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address())));
  },
  async close() {
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    clearInterval(matchmaking);
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => httpServer.close(resolve));
  },
};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let store = null;
  if (process.env.CLOUDBASE_APIKEY && process.env.TCB_ENV) {
    const { createPGStore } = await import('./pg-store.mjs');
    const candidate = createPGStore({ scope: process.env.COMPETITION_SCOPE || 'live' });
    try { await candidate.operation('recover'); store = candidate; }
    catch { console.error('Competition storage unavailable; friend rooms remain available.'); }
  }
  const server = createRoomServer({ store });
  const address = await server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0');
  console.log(`Air Hockey room server listening on ${address.address}:${address.port}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
}
