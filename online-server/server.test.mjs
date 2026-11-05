import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoomServer } from './server.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { const value = predicate(); if (value) return value; await wait(15); }
  throw new Error('Timed out waiting for room state');
}
async function connect(url) {
  const socket = new WebSocket(url), messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, messages, send: m => socket.send(JSON.stringify(m)) };
}

test('two humans, authoritative scores, stale input, terminal snapshot and rematch', async () => {
  const server = createRoomServer();
  const address = await server.listen();
  try {
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const a = await connect(url), b = await connect(url);
    a.send({ type: 'room.create' });
    const joined = await until(() => a.messages.find(m => m.type === 'room.joined'));
    const room = server.rooms.get(joined.state.code);
    a.send({ type: 'room.create' });
    await until(() => a.messages.find(m => m.code === 'already_in_room'));
    assert.equal(server.rooms.size, 1, 'duplicate create does not leak an empty room');
    b.send({ type: 'room.join', code: room.code });
    const second = await until(() => b.messages.find(m => m.type === 'room.joined'));
    assert.equal(second.slot, 1);
    a.send({ type: 'player.ready', ready: true }); b.send({ type: 'player.ready', ready: true });
    await until(() => a.messages.find(m => m.type === 'match.start'));
    assert.equal(room.game.multiplayer, true);
    a.send({ type: 'player.active', active: false });
    await until(() => room.game.phase === 'paused');
    const timer = room.game.timer; await wait(50);
    assert.equal(room.game.timer, timer, 'backgrounding one peer freezes the shared match');
    a.send({ type: 'player.active', active: true });
    await until(() => room.game.phase === 'countdown');
    a.send({ type: 'input', seq: 10, x: 200, y: 130 });
    a.send({ type: 'input', seq: 9, x: 400, y: 400 });
    await until(() => room.clients[0].lastSeq === 10);
    assert.deepEqual(room.game.target, { x: 200, y: 130 });
    b.send({ type: 'input', seq: 0, x: -999, y: 999 });
    await until(() => room.clients[1].lastSeq === 0);
    assert(room.game.aiTarget.x >= 545 && room.game.aiTarget.y <= 518, 'opponent stays in own half');
    // A fake client score cannot alter authoritative score.
    a.send({ type: 'score', score: 999 });
    await until(() => a.messages.find(m => m.code === 'unknown_message'));
    assert.deepEqual(room.game.score, { player: 0, computer: 0 });
    // Let the real physics process the fifth goal and send its terminal snapshot.
    room.game.phase = 'playing'; room.game.score.player = 4;
    Object.assign(room.game.puck, { x: 1017, y: 280, vx: 300, vy: 0 });
    const final = await until(() => b.messages.find(m => m.type === 'snapshot' && m.phase === 'finished'));
    assert.equal(final.score.player, 5);
    assert(b.messages.some(m => m.type === 'match.finish' && m.event.winner === 'player'));
    assert.equal(room.started, false);
    a.send({ type: 'player.ready', ready: true }); b.send({ type: 'player.ready', ready: true });
    await until(() => a.messages.filter(m => m.type === 'match.start').length === 2);
    assert.deepEqual(room.game.score, { player: 0, computer: 0 });
    assert.equal(room.game.multiplayer, true);
    a.socket.close();
    await until(() => b.messages.find(m => m.type === 'room.peer_left'));
    assert.equal(room.game.phase, 'ready'); assert.equal(room.started, false);
    const c = await connect(url); c.send({ type: 'room.join', code: room.code });
    const replacement = await until(() => c.messages.find(m => m.type === 'room.joined'));
    assert.equal(replacement.slot, 0, 'replacement fills the vacant side');
    assert.equal(new Set(room.clients.map(client => client.slot)).size, 2);
  } finally { await server.close(); }
});
