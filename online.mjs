import { ONLINE_SERVER } from './online-config.mjs';

export function createOnlineClient({ onChange = () => {}, onSnapshot = () => {}, onEvent = () => {}, host = window } = {}) {
  const endpoint = host.AirHockeyOnlineConfig?.url || ONLINE_SERVER;
  let socket = null, opening = null, seq = 0, lastInput = -Infinity;
  let credential = null, requestSequence = 0, retryTimer = null, recovering = false, retryUntil = 0, retryCount = 0;
  let recoveryEpoch = 0, recoveryDeadlineTimer = null, queueEpoch = 0;
  const pending = new Map();
  const later = (callback, delay) => (host.setTimeout || globalThis.setTimeout)(callback, delay);
  const cancelTimer = timer => (host.clearTimeout || globalThis.clearTimeout)(timer);
  let state = { phase: 'offline', room: null, slot: null, error: '', queuedAt: null, ratedResult: null };
  function change(values) { state = { ...state, ...values }; onChange(state); }
  function send(message) {
    if (socket?.readyState !== host.WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message)); return true;
  }
  function failRequests(current, message = '连接已中断，请重新操作。') {
    for (const [id, request] of pending) if (request.socket === current) {
      cancelTimer(request.timer); pending.delete(id);
      const error = new Error(message); error.code = 'cancelled'; request.reject(error);
    }
  }
  function request(type, data, expected) {
    return new Promise((resolve, reject) => {
      const requestId = `r${++requestSequence}`;
      const timer = later(() => {
        pending.delete(requestId);
        if (type === 'queue.join') send({ type: 'queue.cancel' });
        reject(new Error('操作响应超时，请稍后重试。'));
      }, 15000);
      pending.set(requestId, { resolve, reject, timer, expected, socket });
      if (!send({ type, ...data, requestId })) {
        cancelTimer(timer); pending.delete(requestId); reject(new Error('连接尚未就绪。'));
      }
    });
  }
  function scheduleRecovery() {
    if (!credential || retryTimer || recovering) return;
    if (host.performance.now() >= retryUntil) {
      change({ phase: 'offline', room: null, slot: null, error: '重连时间已过，请查看战绩后重新匹配。' }); return;
    }
    retryTimer = later(async () => {
      retryTimer = null; recovering = true;
      const epoch = recoveryEpoch, savedCredential = credential;
      let retry = false;
      try {
        await connect();
        if (epoch !== recoveryEpoch || credential !== savedCredential) return;
        await request('account.login', { token: savedCredential }, 'account.session');
        if (epoch !== recoveryEpoch) return;
        await request('ranked.resume', {}, 'room.joined');
        if (epoch !== recoveryEpoch) return;
        cancelTimer(recoveryDeadlineTimer); recoveryDeadlineTimer = null;
        retryUntil = 0; retryCount = 0;
      } catch (error) {
        if (epoch !== recoveryEpoch) return;
        if (['match_expired', 'invalid_account'].includes(error.code)) {
          change({ phase: 'offline', room: null, slot: null, error: '本局已经结束，请查看战绩后重新匹配。' });
        } else retry = true;
      } finally { if (epoch === recoveryEpoch) { recovering = false; if (retry) scheduleRecovery(); } }
    }, Math.min(3000, 500 * 2 ** retryCount++));
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
        const waiting = pending.get(message.requestId);
        if (waiting && (message.type === waiting.expected || message.type === 'error')) {
          pending.delete(message.requestId); cancelTimer(waiting.timer);
          if (message.type === 'error') { const error = new Error('排位操作未能完成，请稍后重试。'); error.code = message.code; waiting.reject(error); }
          else waiting.resolve(message);
        }
        if (message.type === 'account.session') change({ accountProfile: message.profile });
        else if (message.type === 'room.joined') {
          seq = 0; lastInput = -Infinity;
          change({ phase: 'room', slot: message.slot, room: message.state, error: '', queuedAt: null });
        } else if (message.type === 'room.state' || message.type === 'match.start') {
          change({ room: message.state, phase: 'room', ...(message.type === 'match.start' || message.state.players.length === 2 ? { error: '' } : {}) });
        } else if (message.type === 'room.peer_left') {
          change({ room: message.state, error: '对手已离开，本局结束。可以等待另一位球友加入。' });
        } else if (message.type === 'queue.waiting') change({ phase: 'queue', queuedAt: message.queuedAt, ratedResult: null, error: '' });
        else if (message.type === 'queue.cancelled') change({ phase: 'lobby', queuedAt: null, error: '' });
        else if (message.type === 'ranked.result') change({ ratedResult: message.result, accountProfile: message.result?.profile, error: '' });
        else if (message.type === 'ranked.cancelled') change({ phase: 'lobby', room: null, slot: null, queuedAt: null, error: '本局已取消，不计入排位战绩。' });
        else if (message.type === 'snapshot') onSnapshot(message, state.slot);
        else if (message.type === 'room.left') change({ phase: 'lobby', room: null, slot: null });
        else if (message.type === 'error') {
          const labels = { room_full: '房间不存在或已经满员，请核对房间码。', room_expired: '房间已过期，请重新创建。', room_capacity: '房间暂时已满，请稍后再试。',
            already_in_match: '这个赛号已经在匹配或对局中，请先回到原来的球桌。', account_required: '请先关联 B站云档。',
            invalid_account: '赛号关联已失效，请重新关联 B站云档。', competition_unavailable: '排位服务暂时不可用，请稍后再试。',
            storage_unavailable: '战绩服务暂时不可用，请稍后再试。', match_expired: '重连时间已过，本局已经结束。', inactive: '请回到前台后重新匹配。' };
          change({ error: labels[message.code] || '这次操作未能完成，请再试一次。', ...(message.code === 'room_expired' ? { room: null, slot: null, phase: 'lobby' } : {}) });
        } else if (message.event) onEvent(message.event, state.slot);
      };
      current.onerror = () => { reject(new Error('暂时连不上对战服务，请稍后再试。')); current.close(); };
      current.onclose = () => {
        reject(new Error('连接已断开，请重新进入房间。'));
        failRequests(current);
        if (socket !== current) return;
        socket = null;
        if (credential && state.room?.ranked && state.room.started) {
          if (!retryUntil) {
            retryUntil = host.performance.now() + 20000;
            const epoch = recoveryEpoch;
            recoveryDeadlineTimer = later(() => {
              if (epoch !== recoveryEpoch || !retryUntil) return;
              recoveryEpoch += 1; recovering = false;
              cancelTimer(retryTimer); retryTimer = null; retryUntil = 0;
              const stuck = socket; socket = null; opening = null; credential = null;
              failRequests(stuck); stuck?.close();
              change({ phase: 'offline', room: null, slot: null, error: '重连窗口已结束，请查看战绩后重新匹配。' });
            }, 20000);
          }
          change({ phase: 'reconnecting', error: '连接中断，正在尝试重连…' }); scheduleRecovery(); return;
        }
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
    async queue(token) {
      const epoch = ++queueEpoch;
      credential = token;
      await connect();
      if (epoch !== queueEpoch) return;
      const current = socket;
      await request('account.login', { token }, 'account.session');
      if (socket !== current || epoch !== queueEpoch) return;
      await request('queue.join', { token }, 'queue.waiting');
    },
    cancelQueue() { queueEpoch += 1; send({ type: 'queue.cancel' }); failRequests(socket, '已取消匹配。'); change({ phase: 'lobby', queuedAt: null, error: '' }); },
    retrySettlement() { send({ type: 'ranked.retry' }); },
    ready() { send({ type: 'player.ready', ready: true }); },
    setActive(active) {
      if (!active && !state.room) {
        queueEpoch += 1; failRequests(socket, '已暂停匹配。'); send({ type: 'queue.cancel' });
        change({ phase: 'lobby', queuedAt: null, error: '' });
      }
      send({ type: 'player.active', active: Boolean(active) });
    },
    input(x, y) {
      if (state.phase !== 'room' || !state.room?.started) return;
      const now = host.performance.now(); if (now - lastInput < 1000 / 30) return;
      lastInput = now;
      const target = localPoint({ x, y }, state.slot);
      send({ type: 'input', seq: seq++, x: target.x, y: target.y });
    },
    leave() {
      const current = socket;
      if (state.room) send({ type: 'room.leave' }); else send({ type: 'queue.cancel' });
      credential = null; retryUntil = 0; cancelTimer(retryTimer); retryTimer = null;
      queueEpoch += 1; recoveryEpoch += 1; recovering = false;
      cancelTimer(recoveryDeadlineTimer); recoveryDeadlineTimer = null;
      socket = null; opening = null; failRequests(current);
      current?.close();
      change({ phase: 'offline', room: null, slot: null, error: '', queuedAt: null, ratedResult: null, accountProfile: null });
    },
    localPoint,
    localSide(side, slot) { return slot === 1 ? (side === 'player' ? 'computer' : 'player') : side; },
  };
}
