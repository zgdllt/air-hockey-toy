import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const { AirHockey } = require('./physics.cjs');

const TICK_HZ = 30;
const MAX_ROOMS = 1000;
const ROOM_TTL_MS = 15 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function createRoomServer() {
const rooms = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'yi-peng-air-online', rooms: rooms.size });
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
    players: room.clients.map((client) => ({ slot: client.slot, ready: client.ready, active: client.active })),
    maxPlayers: 2,
    tick: room.tick,
    started: room.started,
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

function createRoom() {
  if (rooms.size >= MAX_ROOMS) throw new Error('room_capacity');
  const code = newCode();
  const room = {
    code,
    tick: 0,
    lastActive: Date.now(),
    started: false,
    clients: [],
    events: [],
    playerStats: [{ playerHits: 0, fastestShot: 0 }, { playerHits: 0, fastestShot: 0 }],
    game: new AirHockey({ difficulty: 'standard', random: Math.random, onEvent: (event) => room.events.push(event) }),
  };
  rooms.set(code, room);
  return room;
}

function removeClient(client) {
  const room = client.room;
  if (!room) return;
  room.clients = room.clients.filter((candidate) => candidate !== client);
  room.lastActive = Date.now();
  room.started = false;
  room.game.reset();
  room.events.length = 0;
  room.clients.forEach(peer => { peer.ready = false; });
  broadcast(room, { type: 'room.peer_left', slot: client.slot, state: roomState(room) });
  client.room = null;
  if (room.clients.length === 0) rooms.delete(room.code);
}

function startIfReady(room) {
  if (room.clients.length !== 2 || !room.clients.every((client) => client.ready && client.active) || room.started) return;
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
  room.lastActive = Date.now();
  send(client, { type: 'room.joined', slot: client.slot, state: roomState(room) });
  send(client, snapshot(room));
  broadcast(room, { type: 'room.state', state: roomState(room) });
}

function handleMessage(client, message) {
  if (!message || typeof message.type !== 'string') throw new Error('invalid_message');
  client.lastMessage = Date.now();
  if (message.type === 'hello') {
    // Production must validate a server-issued token produced after wx.login.
    // No AppSecret belongs in this process's client-facing source.
    client.session = typeof message.session === 'string' ? message.session.slice(0, 256) : null;
    send(client, { type: 'hello.ok', protocol: 1, serverTime: Date.now() });
    return;
  }
  if (message.type === 'room.create') {
    if (client.room) throw new Error('already_in_room');
    joinRoom(client, createRoom());
    return;
  }
  if (message.type === 'room.join') {
    const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    joinRoom(client, rooms.get(code));
    return;
  }
  if (!client.room) throw new Error('not_in_room');
  const room = client.room;
  room.lastActive = Date.now();
  if (message.type === 'player.active') {
    client.active = Boolean(message.active);
    if (room.started) {
      if (room.clients.some(peer => !peer.active)) room.game.pause();
      else room.game.resume();
    }
    broadcast(room, { type: 'room.state', state: roomState(room) });
    return;
  }
  if (message.type === 'player.ready') {
    client.ready = Boolean(message.ready);
    client.active = true;
    broadcast(room, { type: 'room.state', state: roomState(room) });
    startIfReady(room);
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
    removeClient(client);
    send(client, { type: 'room.left' });
    return;
  }
  throw new Error('unknown_message');
}

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const client = { ws, room: null, slot: -1, ready: false, session: null, lastMessage: Date.now(), lastSeq: -1 };
  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      handleMessage(client, message);
    } catch (error) {
      send(client, { type: 'error', code: error?.message || 'invalid_message' });
    }
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

const timer = setInterval(() => {
  const dt = 1 / TICK_HZ;
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.length === 0 || now - room.lastActive > ROOM_TTL_MS) {
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
        room.started = false; room.clients.forEach(client => { client.ready = false; });
        broadcast(room, { type: 'room.state', state: roomState(room) });
      }
    }
  }
}, 1000 / TICK_HZ);

return {
  rooms,
  listen(port = 0, host = '127.0.0.1') {
    return new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address())));
  },
  async close() {
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => httpServer.close(resolve));
  },
};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createRoomServer();
  const address = await server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0');
  console.log(`Air Hockey room server listening on ${address.address}:${address.port}`);
}
