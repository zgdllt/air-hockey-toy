import { ONLINE_SERVER } from './online-config.mjs';

const CLOUD_KEY = 'air_hockey_identity_v1';
const LOCAL_KEY = 'air-hockey-linked-account-v1';
const JOURNAL_KEY = 'air-hockey-practice-journal-v1';
const labels = {
  competition_unavailable: '排位与战绩服务暂时不可用，单人练习和好友房间仍可使用。',
  storage_unavailable: '战绩暂时没能保存，请稍后重试。',
  invalid_account: '云档关联已失效，请重新关联。',
  invalid_link: '授权信息不匹配，请重新生成授权码。',
  link_expired: '授权码已过期或已经使用，请重新生成。',
  link_claimed: '这个授权码已经由另一个赛号批准，请重新生成。',
};

export function newMatchId(host = window) {
  if (host.crypto.randomUUID) return host.crypto.randomUUID();
  const bytes = host.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCompetitionClient({ platform, host = window, onChange = () => {} }) {
  const endpoint = host.AirHockeyOnlineConfig?.url || ONLINE_SERVER;
  const isToy = () => Boolean(platform.isToy?.());
  let token = null, identityFlight = null, flushing = null, pairEpoch = 0, pairTimer;
  let profileEpoch = 0;
  let state = { phase: 'unbound', profile: null, pair: null, error: '' };
  let journal;
  try { journal = JSON.parse(host.localStorage.getItem(JOURNAL_KEY) || '[]'); } catch { journal = []; }
  if (!Array.isArray(journal)) journal = [];
  function change(values) { state = { ...state, ...values }; onChange(state); }
  function saveJournal() {
    try { host.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal)); } catch { /* Keep the in-memory journal for this session. */ }
  }
  function persistCredential(value) {
    // Toy authors can share a browser origin: never put a Toy credential in localStorage.
    if (!isToy()) host.localStorage.setItem(LOCAL_KEY, JSON.stringify({ token: value }));
  }
  function rpc(action, args = {}, credential = token) {
    return new Promise((resolve, reject) => {
      const socket = new host.WebSocket(endpoint);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; host.clearTimeout(timer); socket.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = host.setTimeout(() => finish(new Error('对战服务响应超时，请稍后重试。')), 30000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'service.request', requestId: 'request', action, args, token: credential }));
      socket.onmessage = ({ data }) => {
        let message; try { message = JSON.parse(data); } catch { return; }
        if (message.requestId !== 'request') return;
        if (message.type === 'error') {
          const error = new Error(labels[message.code] || '这次操作没有完成，请稍后重试。'); error.code = message.code; finish(error);
        } else if (message.type === 'service.response') finish(null, message.result);
      };
      socket.onerror = () => finish(new Error('暂时连不上对战服务，请稍后重试。'));
      socket.onclose = () => { if (!settled) finish(new Error('连接已中断，请重新操作。')); };
    });
  }
  function activate(credential, profile) {
    persistCredential(credential); token = credential;
    profileEpoch += 1;
    change({ phase: 'active', profile, pair: null, error: '' });
  }
  async function ensureIdentity() {
    if (state.profile && token) return { token, profile: state.profile };
    if (identityFlight) return identityFlight;
    identityFlight = (async () => {
      change({ phase: 'loading', error: '' });
      try {
        let saved;
        if (isToy()) {
          const cloud = await platform.call('getCloudStorage', [CLOUD_KEY]);
          try { saved = JSON.parse(cloud[CLOUD_KEY] || '{}').token; } catch { throw new Error('云档关联数据无法读取，请稍后重试。'); }
          if (!saved) {
            const created = await rpc('account.open', {}, null);
            await platform.call('setCloudStorage', { [CLOUD_KEY]: JSON.stringify({ v: 1, token: created.token }) });
            // Concurrent first-use devices converge on the credential actually saved by the platform.
            const confirmed = await platform.call('getCloudStorage', [CLOUD_KEY]);
            saved = JSON.parse(confirmed[CLOUD_KEY] || '{}').token;
            if (!saved) throw new Error('B站云档尚未确认保存，请重试关联。');
          }
        } else {
          try { saved = JSON.parse(host.localStorage.getItem(LOCAL_KEY) || '{}').token; } catch { /* No linked credential. */ }
          if (!saved) throw new Error('请先用 B站 Toy 批准这台设备的授权码。');
        }
        const result = await rpc('account.open', {}, saved);
        activate(saved, result.profile);
        return { token, profile: state.profile };
      } catch (error) {
        change({ phase: 'unbound', error: error.message }); throw error;
      } finally { identityFlight = null; }
    })();
    return identityFlight;
  }
  async function flushPractice() {
    if (flushing) return flushing;
    flushing = (async () => {
      const identity = await ensureIdentity();
      for (const result of [...journal]) {
        if (result.accountId && result.accountId !== identity.profile.id) continue;
        result.accountId = identity.profile.id; saveJournal();
        const version = profileEpoch;
        const profile = await rpc('solo.submit', result, identity.token);
        journal = journal.filter(item => item.matchId !== result.matchId); saveJournal();
        if (state.profile?.id === profile.id) {
          if (version === profileEpoch) { profileEpoch += 1; change({ profile }); }
          else {
            const freshVersion = profileEpoch;
            const fresh = await rpc('account.open', {}, identity.token);
            if (state.profile?.id === fresh.profile.id && freshVersion === profileEpoch) {
              profileEpoch += 1; change({ profile: fresh.profile });
            }
          }
        }
      }
    })();
    try { return await flushing; } finally { flushing = null; }
  }
  return {
    isToy,
    get state() { return state; },
    get pendingPractice() { return journal.filter(result => !result.accountId || result.accountId === state.profile?.id).length; },
    ensureIdentity, flushPractice,
    async credential() { return (await ensureIdentity()).token; },
    board: filters => rpc('board.list', filters),
    recordPractice(result) {
      if (journal.some(item => item.matchId === result.matchId)) return;
      journal.push({ ...result, accountId: state.profile?.id || null }); saveJournal();
      if (state.profile) void flushPractice().catch(error => change({ error: error.message }));
    },
    updateProfile(profile) {
      if (state.profile?.id === profile?.id && state.profile !== profile) { profileEpoch += 1; change({ profile, error: '' }); }
    },
    cancelLink() {
      pairEpoch += 1; host.clearTimeout(pairTimer);
      change({ phase: state.profile ? 'active' : 'unbound', pair: null });
    },
    async startLink() {
      const epoch = ++pairEpoch; host.clearTimeout(pairTimer);
      change({ phase: 'loading', pair: null, error: '' });
      try {
        const pair = await rpc('link.create', {}, null);
        if (epoch !== pairEpoch) return;
        change({ phase: 'awaiting', pair });
        const poll = async () => {
          if (epoch !== pairEpoch) return;
          try {
            const result = await rpc('link.poll', { code: pair.code, pollToken: pair.pollToken }, null);
            if (epoch !== pairEpoch) return;
            if (result.approved) { activate(result.token, result.profile); return; }
            pairTimer = host.setTimeout(poll, 2000);
          } catch (error) {
            if (epoch === pairEpoch) change({ phase: 'unbound', pair: null, error: error.message });
          }
        };
        pairTimer = host.setTimeout(poll, 1000);
        return pair;
      } catch (error) { if (epoch === pairEpoch) change({ phase: 'unbound', error: error.message }); }
    },
    async approveLink(code) {
      const identity = await ensureIdentity();
      return rpc('link.approve', { code: code.trim().toUpperCase() }, identity.token);
    },
  };
}
