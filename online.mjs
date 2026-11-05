import { ONLINE_SERVER } from './online-config.mjs';

export function createOnlineClient({ onChange = () => {}, onSnapshot = () => {}, onEvent = () => {}, host = window } = {}) {
  const endpoint = host.AirHockeyOnlineConfig?.url || ONLINE_SERVER;
  let socket = null, opening = null, seq = 0, lastInput = -Infinity;
  let state = { phase: 'offline', room: null, slot: null, error: '' };
  function change(values) { state = { ...state, ...values }; onChange(state); }
  function send(message) {
    if (socket?.readyState !== host.WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message)); return true;
  }
  async function connect() {
    if (!endpoint) throw new Error('好友对战服务还未上线，你可以先玩单人模式。');
    if (socket?.readyState === host.WebSocket.OPEN) return;
    if (opening) return opening;
    change({ phase: 'connecting', error: '' });
    const attempt = new Promise((resolve, reject) => {
      const current = new host.WebSocket(endpoint); socket = current;
      current.onopen = () => { if (socket !== current) return; change({ phase: 'lobby' }); resolve(); };
      current.onmessage = ({ data }) => {
        if (socket !== current) return;
        let message; try { message = JSON.parse(data); } catch { return; }
        if (message.type === 'room.joined') {
          seq = 0; lastInput = -Infinity;
          change({ phase: 'room', slot: message.slot, room: message.state, error: '' });
        } else if (message.type === 'room.state' || message.type === 'match.start') {
          change({ room: message.state, phase: 'room', ...(message.type === 'match.start' || message.state.players.length === 2 ? { error: '' } : {}) });
        } else if (message.type === 'room.peer_left') {
          change({ room: message.state, error: '对手已离开，本局结束。可以等待另一位球友加入。' });
        } else if (message.type === 'snapshot') onSnapshot(message, state.slot);
        else if (message.type === 'room.left') change({ phase: 'lobby', room: null, slot: null });
        else if (message.type === 'error') {
          const labels = { room_full: '房间不存在或已经满员，请核对房间码。', room_expired: '房间已过期，请重新创建。', room_capacity: '房间暂时已满，请稍后再试。' };
          change({ error: labels[message.code] || '这次操作未能完成，请再试一次。', ...(message.code === 'room_expired' ? { room: null, slot: null, phase: 'lobby' } : {}) });
        } else if (message.event) onEvent(message.event, state.slot);
      };
      current.onerror = () => { reject(new Error('暂时连不上对战服务，请稍后再试。')); current.close(); };
      current.onclose = () => {
        reject(new Error('连接已断开，请重新进入房间。'));
        if (socket !== current) return;
        socket = null;
        change({ phase: 'offline', room: null, slot: null, error: '连接已断开，请重新进入房间。' });
      };
    });
    opening = attempt;
    try { return await attempt; }
    finally { if (opening === attempt) opening = null; }
  }
  function localPoint(point, slot) {
    return slot === 1 ? { x: 1000 - point.x, y: 560 - point.y,
      ...('vx' in point ? { vx: -point.vx, vy: -point.vy } : {}) } : { ...point };
  }
  return {
    configured: Boolean(endpoint),
    get state() { return state; },
    async create() { await connect(); send({ type: 'room.create' }); },
    async join(code) { await connect(); send({ type: 'room.join', code }); },
    ready() { send({ type: 'player.ready', ready: true }); },
    setActive(active) { send({ type: 'player.active', active: Boolean(active) }); },
    input(x, y) {
      if (state.phase !== 'room' || !state.room?.started) return;
      const now = host.performance.now(); if (now - lastInput < 1000 / 30) return;
      lastInput = now;
      const target = localPoint({ x, y }, state.slot);
      send({ type: 'input', seq: seq++, x: target.x, y: target.y });
    },
    leave() {
      const current = socket; socket = null; opening = null;
      current?.close();
      change({ phase: 'offline', room: null, slot: null, error: '' });
    },
    localPoint,
    localSide(side, slot) { return slot === 1 ? (side === 'player' ? 'computer' : 'player') : side; },
  };
}
