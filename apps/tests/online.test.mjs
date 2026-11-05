import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const nested = new URL('../../web/air-hockey/online.mjs', import.meta.url);
const { createOnlineClient } = await import(existsSync(nested) ? nested : new URL('../../online.mjs', import.meta.url));

const sockets = [];
class FakeSocket {
  static OPEN = 1;
  constructor() { this.readyState = 0; sockets.push(this); }
  send(value) { this.last = JSON.parse(value); }
  close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  open() { this.readyState = 1; this.onopen?.(); }
}
const host = { WebSocket: FakeSocket, AirHockeyOnlineConfig: { url: 'ws://test/ws' }, performance: { now: () => 0 } };
const client = createOnlineClient({ host });
const canceled = client.create().catch(error => error.message);
client.leave();
const next = client.create();
assert.equal(sockets.length, 2, 'canceling a connection allows a new attempt immediately');
sockets[1].open();
await next; await canceled;
assert.equal(client.state.phase, 'lobby', 'old close does not disconnect new connection');
sockets[1].onmessage({ data: JSON.stringify({ type: 'room.joined', slot: 1, state: { code: 'ABC123', started: true } }) });
client.input(100, 200);
assert.deepEqual(sockets[1].last, { type: 'input', seq: 0, x: 900, y: 360 });
assert.deepEqual(client.localPoint({ x: 800, y: 300, vx: 40, vy: -70 }, 1), { x: 200, y: 260, vx: -40, vy: 70 });
assert.equal(client.localSide('computer', 1), 'player');
client.leave();
console.log('connection cancellation, fresh reconnect, slot 1 input and view mapping passed');
