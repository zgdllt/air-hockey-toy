export const RANK_BOARDS = Object.freeze({ warmup: 1, standard: 2, challenge: 3 });

// SDK scores are absolute personal bests, separated by difficulty.
export function createLeaderboard({ platform, competition, root = document, onOpen = () => {}, onAccount = () => {} }) {
  const $ = selector => root.querySelector(selector);
  const dialog = $('#leaderboard-dialog');
  const boardSelect = $('#rank-difficulty');
  const periodSelect = $('#rank-period');
  const modeSelect = $('#rank-mode');
  const metricSelect = $('#rank-metric');
  const list = $('#rank-list');
  const state = $('#rank-status');
  const mine = $('#rank-mine');
  const submit = $('#submit-score');
  const cache = new Map();
  let request = 0;
  let generation = 0;
  let pending = null;
  function scoreText(item) {
    const score = Number(item.score) || 0;
    if (metricSelect.value === 'combo') return `×${score}`;
    if (metricSelect.value === 'rate') return `${Number(item.win_rate ?? score).toFixed(1).replace(/\.0$/, '')}%`;
    if (metricSelect.value === 'streak') return `${score} 连胜`;
    if (metricSelect.value === 'wins') return `${score} 胜`;
    return `${score} Elo`;
  }
  function filters() {
    const ranked = modeSelect.value === 'ranked';
    metricSelect.querySelector('[value=combo]').disabled = ranked;
    metricSelect.querySelector('[value=elo]').disabled = !ranked;
    if (ranked && metricSelect.value === 'combo') metricSelect.value = 'elo';
    if (!ranked && metricSelect.value === 'elo') metricSelect.value = 'combo';
    $('#rank-difficulty-field').hidden = ranked;
    periodSelect.disabled = metricSelect.value === 'elo';
    if (periodSelect.disabled) periodSelect.value = 'all';
    submit.hidden = !pending || ranked || metricSelect.value !== 'combo';
    $('#sync-practice').hidden = ranked || metricSelect.value === 'combo';
    $('#rank-description').textContent = metricSelect.value === 'combo'
      ? '单局最高连续好球，三种难度分别计榜。'
      : ranked ? '排位由服务器结算，好友房间不计入。胜率榜满 10 局参与排名，Elo 为当前积分。'
        : '三种难度分别计榜，从新版完整对局开始累计；胜率榜满 10 局参与排名，不影响 Elo。';
  }
  function render(data) {
    list.replaceChildren();
    data.list.forEach(item => {
      const row = root.createElement('li');
      const rank = root.createElement('span'); rank.className = 'rank-place'; rank.textContent = String(item.rank);
      const name = root.createElement('span'); name.className = 'rank-name'; name.textContent = item.nickname || item.alias || '球友';
      if (item.games !== undefined) {
        const detail = root.createElement('small'); detail.className = 'rank-detail';
        detail.textContent = `${item.wins} 胜 / ${item.games} 局 · 当前 ${item.streak} 连胜`; name.append(detail);
      }
      const score = root.createElement('strong'); score.textContent = scoreText(item);
      row.append(rank, name, score); list.append(row);
    });
    state.textContent = data.list.length ? (metricSelect.value === 'combo' ? '同分先达成者在前。' : '战绩已同步；切换榜单或手动刷新查看。')
      : metricSelect.value === 'rate' ? '这个榜还空着，完成 10 局后参与胜率排名。' : '这个榜还空着，来打出第一份成绩。';
    mine.textContent = data.mine ? (data.mine.ranked ? `你的排名 #${data.mine.rank} · ${scoreText(data.mine)}`
      : metricSelect.value === 'rate' ? `当前 ${scoreText(data.mine)} · 已完成 ${data.mine.games || 0} 局，还需 ${Math.max(0, 10 - (data.mine.games || 0))} 局参与胜率排名。`
        : '你还未上榜，完成比赛并同步战绩后参与排名。') : '关联 B站云档后可查看你的排名。';
  }
  async function load(refresh = false) {
    const ticket = ++request;
    const version = generation;
    filters();
    const board = RANK_BOARDS[boardSelect.value], period = periodSelect.value;
    const combo = metricSelect.value === 'combo';
    const key = `${modeSelect.value}:${metricSelect.value}:${board}:${period}`;
    if (!refresh && cache.has(key)) { render(cache.get(key)); return; }
    state.textContent = '正在读取排行榜…'; mine.textContent = ''; list.replaceChildren();
    try {
      let data;
      if (combo) {
        const [rankResult, myResult] = await Promise.allSettled([
          platform.call('getRankList', { board, period, limit: 30 }), platform.call('getMyRank', { board, period }),
        ]);
        if (rankResult.status === 'rejected') throw rankResult.reason;
        data = { list: rankResult.value, mine: myResult.status === 'fulfilled' ? myResult.value : null };
      } else data = await competition.board({ mode: modeSelect.value, metric: metricSelect.value, difficulty: boardSelect.value, period });
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
      cache.clear();
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
  modeSelect.addEventListener('change', () => void load());
  metricSelect.addEventListener('change', () => void load());
  periodSelect.addEventListener('change', () => void load());
  $('#rank-refresh').addEventListener('click', () => void load(true));
  submit.addEventListener('click', () => void submitResult());
  $('#account-button').addEventListener('click', onAccount);
  $('#sync-practice').addEventListener('click', async () => {
    const button = $('#sync-practice'); button.disabled = true;
    try { await competition.flushPractice(); generation += 1; cache.clear(); await load(true); $('#score-status').textContent = '练习战绩已同步。'; }
    catch (error) { $('#score-status').textContent = error.message; if (!competition.state.profile) onAccount(); }
    finally { button.disabled = false; }
  });
  dialog.addEventListener('close', () => { request += 1; });
  return {
    open(difficulty, mode = 'solo') {
      onOpen(); boardSelect.value = difficulty; modeSelect.value = mode;
      if (!dialog.open) dialog.showModal();
      void load();
    },
    invalidate() { generation += 1; cache.clear(); if (dialog.open) void load(); },
    setResult(difficulty, score) {
      pending = { difficulty, score, submitted: false, busy: false };
      submit.hidden = false; submit.disabled = false;
      const label = { warmup: '热身', standard: '标准', challenge: '挑战' }[difficulty];
      submit.textContent = `提交${label}连击 ×${score}`;
      $('#score-status').textContent = '由你主动提交；首次上榜会由 B站确认用户资料。';
      filters();
    },
    clearResult() { pending = null; submit.hidden = true; $('#score-status').textContent = ''; },
  };
}
