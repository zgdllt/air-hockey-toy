export const RANK_BOARDS = Object.freeze({ warmup: 1, standard: 2, challenge: 3 });

// SDK scores are absolute personal bests, separated by difficulty.
export function createLeaderboard({ platform, root = document, onOpen = () => {} }) {
  const $ = selector => root.querySelector(selector);
  const dialog = $('#leaderboard-dialog');
  const boardSelect = $('#rank-difficulty');
  const periodSelect = $('#rank-period');
  const list = $('#rank-list');
  const state = $('#rank-status');
  const mine = $('#rank-mine');
  const submit = $('#submit-score');
  const cache = new Map();
  let request = 0;
  let generation = 0;
  let pending = null;
  function render(data) {
    list.replaceChildren();
    data.list.forEach(item => {
      const row = root.createElement('li');
      const rank = root.createElement('span'); rank.className = 'rank-place'; rank.textContent = String(item.rank);
      const name = root.createElement('span'); name.className = 'rank-name'; name.textContent = item.nickname || '球友';
      const score = root.createElement('strong'); score.textContent = `×${item.score}`;
      row.append(rank, name, score); list.append(row);
    });
    state.textContent = data.list.length ? '同分先达成者在前。' : '这个榜还空着，来打出第一串好球。';
    mine.textContent = data.mine ? (data.mine.ranked ? `你的排名 #${data.mine.rank} · 最佳连击 ×${data.mine.score}` : '你还未上榜，打完一局后可以提交。') : '登录 B站后可查看你的排名。';
  }
  async function load(refresh = false) {
    const ticket = ++request;
    const version = generation;
    const board = RANK_BOARDS[boardSelect.value], period = periodSelect.value;
    const key = `${board}:${period}`;
    if (!refresh && cache.has(key)) { render(cache.get(key)); return; }
    state.textContent = '正在读取连击榜…'; mine.textContent = ''; list.replaceChildren();
    try {
      const [rankResult, myResult] = await Promise.allSettled([
        platform.call('getRankList', { board, period, limit: 30 }),
        platform.call('getMyRank', { board, period }),
      ]);
      if (rankResult.status === 'rejected') throw rankResult.reason;
      const data = { list: rankResult.value, mine: myResult.status === 'fulfilled' ? myResult.value : null };
      if (version !== generation) return;
      cache.set(key, data);
      if (ticket === request) render(data);
    } catch (error) {
      if (ticket !== request) return;
      state.textContent = Number(error?.code) === 307044 ? '排行榜有点忙，稍后点刷新再试。' : (error?.message || '排行榜暂时读取失败，请稍后刷新。');
    }
  }
  async function submitResult() {
    if (!pending || pending.busy || pending.submitted) return;
    const result = pending;
    result.busy = true; submit.disabled = true; submit.textContent = '正在提交…';
    try {
      const saved = await platform.call('submitScore', { board: RANK_BOARDS[result.difficulty], score: result.score });
      result.submitted = true;
      generation += 1;
      for (const key of cache.keys()) if (key.startsWith(`${RANK_BOARDS[result.difficulty]}:`)) cache.delete(key);
      if (pending === result) {
        submit.textContent = `已上榜 · 历史最佳 ×${saved.score}`;
        $('#score-status').textContent = '已提交到本局难度的排行榜。';
        if (dialog.open) void load(true);
      }
    } catch (error) {
      if (pending !== result) return;
      submit.disabled = false; submit.textContent = '重试提交连击成绩';
      $('#score-status').textContent = Number(error?.code) === 307044 ? '提交有点忙，本局成绩已保留，请稍后再试。' : (error?.message || '没能提交，请稍后再试。');
    } finally { result.busy = false; }
  }
  boardSelect.addEventListener('change', () => void load());
  periodSelect.addEventListener('change', () => void load());
  $('#rank-refresh').addEventListener('click', () => void load(true));
  submit.addEventListener('click', () => void submitResult());
  dialog.addEventListener('close', () => { request += 1; });
  return {
    open(difficulty) {
      onOpen(); boardSelect.value = difficulty;
      if (!dialog.open) dialog.showModal();
      void load();
    },
    setResult(difficulty, score) {
      pending = { difficulty, score, submitted: false, busy: false };
      submit.hidden = false; submit.disabled = false;
      const label = { warmup: '热身', standard: '标准', challenge: '挑战' }[difficulty];
      submit.textContent = `提交${label}连击 ×${score}`;
      $('#score-status').textContent = '由你主动提交；首次上榜会由 B站确认用户资料。';
    },
    clearResult() { pending = null; submit.hidden = true; $('#score-status').textContent = ''; },
  };
}
