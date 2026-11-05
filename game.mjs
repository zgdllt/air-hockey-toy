import { AirHockey, LEVELS, RINK } from './physics.mjs';
import { createSfx } from './sfx.mjs';
import { createHaptics } from './haptics.mjs';
import { GOOD_SHOT_SPEED, advanceGoodShotCombo, isCombo, comboPitch } from './combo.mjs';
import { createToyPlatform } from './platform.mjs';
import { createLeaderboard } from './leaderboard.mjs';
import { createOnlineClient } from './online.mjs';
import { createCompetitionClient, newMatchId } from './competition-client.mjs';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#rink');
const ctx = canvas.getContext('2d');
const overlay = $('#overlay');
const overlayContent = $('#overlay-content');
const stage = $('#stage');
const game = new AirHockey({ difficulty: 'standard', onEvent: handleEvent });
const hints = { warmup: '适合先找手感。', standard: '有来有回，刚刚好。', challenge: '电脑会追球，角度要更刁。' };
const levelNames = { warmup: '热身', standard: '标准', challenge: '挑战' };
const keys = new Set();
const particles = [];
const trail = [];
const feedbacks = [];
const impacts = [];
let selectedLevel = 'standard';
let lastFrame = performance.now();
let pointerActive = false;
let soundOn = true;
let audioContext;
let noiseBuffer;
let sfx;
let lastWallSound = -1;
let toastTimer;
let bannerTimer;
let screenShake = 0;
let visualTime = 0;
let portraitView = false;
let hapticsOn = true;
let goodShotCombo = 0;
let matchBestCombo = 0;
let onlineMode = false;
let rankedMode = false;
let modeEpoch = 0;
let matchingEpoch = 0;
let practiceMatchId = null;
let lastIdentityProfile = null;
let lastOnlineProfile = null;
let onlineTarget = null;
const onlineEvents = [];
const platform = createToyPlatform();
let rankings;
const competition = createCompetitionClient({ platform, onChange: updateIdentity });
rankings = createLeaderboard({ platform, competition, onOpen: pauseForDialog, onAccount: openAccount });
const online = createOnlineClient({ onChange: updateOnlineState, onSnapshot: applyOnlineSnapshot,
  onEvent(event, slot) {
    if (!onlineMode || slot === null) return;
    onlineEvents.push({ ...event,
      ...(event.side ? { side: online.localSide(event.side, slot) } : {}),
      ...(event.winner ? { winner: online.localSide(event.winner, slot) } : {}),
      ...(event.x !== undefined ? online.localPoint(event, slot) : {}),
    });
  },
});
const hapticsButton = $('#haptics');
const haptics = createHaptics();
let nativeFullscreen = Boolean(window.AirHockeyNative?.getFullscreen?.());
const recordAtStartup = readRecord();
let sessionGames = 0;
let sessionWins = 0;
let cloudWrites = Promise.resolve();

function readRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem('air-hockey-record-v1') || '{}');
    return { wins: Number(parsed.wins) || 0, games: Number(parsed.games) || 0, bestRally: Number(parsed.bestRally) || 0, bestSpeed: Number(parsed.bestSpeed) || 0 };
  } catch { return { wins: 0, games: 0, bestRally: 0, bestSpeed: 0 }; }
}
let record = readRecord();

function saveRecord(result) {
  sessionGames += 1;
  if (result === 'player') sessionWins += 1;
  record.games += 1;
  if (result === 'player') record.wins += 1;
  record.bestRally = Math.max(record.bestRally, game.stats.longestRally);
  record.bestSpeed = Math.max(record.bestSpeed, game.stats.fastestShot);
  try { localStorage.setItem('air-hockey-record-v1', JSON.stringify(record)); } catch { /* private browsing can reject storage */ }
  updateRecord();
  // Wait for the initial cloud merge before writing, including a very fast match.
  cloudWrites = cloudWrites.then(() => cloudReady).then(saveToyRecord);
}

async function loadToyRecord() {
  try {
    if (!await platform.ready()) return;
    const cloud = await platform.call('getCloudStorage', ['air_hockey_wins', 'air_hockey_games', 'air_hockey_best_rally', 'air_hockey_best_speed']);
    record.wins = Math.max(recordAtStartup.wins, Number(cloud.air_hockey_wins) || 0) + sessionWins;
    record.games = Math.max(recordAtStartup.games, Number(cloud.air_hockey_games) || 0) + sessionGames;
    record.bestRally = Math.max(record.bestRally, Number(cloud.air_hockey_best_rally) || 0);
    record.bestSpeed = Math.max(record.bestSpeed, Number(cloud.air_hockey_best_speed) || 0);
    try { localStorage.setItem('air-hockey-record-v1', JSON.stringify(record)); } catch { /* optional storage */ }
    updateRecord();
  } catch (error) {
    if (String(error?.code) === '307044') showToast('Toy 云存储繁忙，已保留本机战绩。');
    /* GitHub Pages and Toy preview can both run without cloud storage. */
  }
}

async function saveToyRecord() {
  try {
    if (!await platform.ready()) return;
    await platform.call('setCloudStorage', {
      air_hockey_wins: String(record.wins),
      air_hockey_games: String(record.games),
      air_hockey_best_rally: String(record.bestRally),
      air_hockey_best_speed: String(Math.round(record.bestSpeed)),
    });
  } catch (error) {
    if (String(error?.code) === '307044') showToast('Toy 云存储繁忙，本局仍已保存在本机。');
    /* No immediate retry: Toy shared quotas are global to the Toy. */
  }
}

function updateRecord() {
  $('#record-wins').textContent = record.wins;
  $('#record-games').textContent = record.games;
  $('#record-caption').textContent = record.games === 0 ? '第一场，从这一拍开始。' : `最佳回合 ${record.bestRally} 拍 · ${Math.round(record.bestSpeed)} px/s`;
}

function setLevel(level) {
  if (!LEVELS[level] || game.phase !== 'ready') return;
  selectedLevel = level;
  document.querySelectorAll('[data-level]').forEach((button) => {
    const active = button.dataset.level === level;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#difficulty-hint').textContent = hints[level];
  $('#match-label').textContent = `先得 ${RINK.winningScore} 分 · ${levelNames[level]}难度`;
  renderOverlay();
}

function handleEvent(event) {
  if (event.type === 'hit') {
    const heavy = event.speed > GOOD_SHOT_SPEED;
    const color = event.side === 'player' ? '#9ce5d9' : '#ef765c';
    const comboCount = event.side === 'player' ? (goodShotCombo = advanceGoodShotCombo(goodShotCombo, event)) : goodShotCombo;
    const comboHit = event.side === 'player' && heavy && isCombo(comboCount);
    if (event.side === 'player') matchBestCombo = Math.max(matchBestCombo, comboCount);
    particles.push({ x: event.x, y: event.y, life: .38, max: .38, color, size: heavy ? 18 : 12 });
    impacts.push({ x: event.x, y: event.y, life: heavy ? .48 : .34, max: heavy ? .48 : .34, color, heavy });
    if (event.side === 'player') {
      feedbacks.push({ x: Math.max(135, Math.min(865, event.x + 68)), y: Math.max(82, Math.min(478, event.y - 48)), text: heavy ? '好球！' : '接住了', color, life: heavy ? 1.34 : 1.02, max: heavy ? 1.34 : 1.02, heavy, flip: event.x > 500 });
      screenShake = Math.max(screenShake, heavy ? .95 : .48);
      showBanner(comboHit ? `COMBO ×${comboCount}` : (heavy ? '好球！' : '接住了'), comboHit ? 'combo' : '');
    }
    playHitSound(event, comboHit ? comboPitch(comboCount) : 1);
    haptics.play(comboHit ? 'combo' : (event.side === 'player' ? (heavy ? 'heavy' : 'hit') : (heavy ? 'opponent-heavy' : 'opponent-hit')));
  } else if (event.type === 'wall') {
    particles.push({ x: event.x, y: event.y, life: .18, max: .18, color: '#f2bd45', size: 7 });
    playWallSound(event);
    const nearPost = POSTS.some(([x, y]) => Math.hypot(event.x - x, event.y - y) <= RINK.puckRadius + RINK.postRadius + 1.5);
    haptics.play(nearPost ? 'post' : 'wall');
  } else if (event.type === 'goal') {
    goodShotCombo = 0;
    showBanner(event.side === 'player' ? '漂亮，得分！' : '别急，下一球');
    $('#goal-flash').classList.remove('show');
    void $('#goal-flash').offsetWidth;
    $('#goal-flash').classList.add('show');
    playGoalSound(event.side === 'player');
    haptics.play(event.side === 'player' ? 'goal' : 'opponent-goal');
  } else if (event.type === 'serve') {
    goodShotCombo = 0;
    renderOverlay();
    showBanner('开拍！');
    playServeSound();
    haptics.play('serve');
  } else if (event.type === 'finish') {
    goodShotCombo = 0;
    if (!onlineMode) {
      saveRecord(event.winner); rankings.setResult(selectedLevel, matchBestCombo);
      competition.recordPractice({ matchId: practiceMatchId || newMatchId(), difficulty: selectedLevel,
        won: event.winner === 'player', for: game.score.player, against: game.score.computer });
    }
    playFinishSound(event.winner === 'player');
    haptics.play(event.winner === 'player' ? 'win' : 'lose');
    setTimeout(() => { renderOverlay(); makeResultCard(event.winner); }, 80);
  } else if (event.type === 'deadball') {
    goodShotCombo = 0;
    showBanner('球停了，重新发球');
    haptics.play('deadball');
  } else if (event.type === 'pause' || event.type === 'resume') {
    haptics.cancel();
    haptics.play(event.type);
    renderOverlay();
  } else if (event.type === 'start') {
    haptics.play('start');
  }
  updateScoreboard();
}

function showBanner(text, variant = '') {
  const banner = $('#play-banner');
  banner.textContent = text;
  banner.classList.remove('combo');
  if (variant === 'combo') void banner.offsetWidth;
  banner.classList.toggle('combo', variant === 'combo');
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), 850);
}

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

let overlayMarkup = '';
function setOverlay(markup) {
  if (markup === overlayMarkup) return;
  overlayMarkup = markup;
  overlayContent.innerHTML = markup;
}

function renderOverlay() {
  const phase = game.phase;
  if (rankedMode && (online.state.phase === 'reconnecting' || (online.state.phase === 'connecting' && online.state.room))) {
    overlay.classList.remove('hidden');
    setOverlay('<span class="ticket-kicker">BACK TO THE TABLE</span><h2>正在重新连接。</h2><p>球桌已暂停。20 秒内重连可继续，超时将按断线结算。</p><button class="text-button" data-action="solo">退出排位，返回单人</button>');
    return;
  }
  if (onlineMode && (!online.state.room?.started && phase !== 'finished')) {
    overlay.classList.remove('hidden');
    const state = online.state;
    if (rankedMode) {
      const waiting = state.phase === 'queue' || state.phase === 'connecting' || matchingEpoch || state.room;
      setOverlay(`<span class="ticket-kicker">FIND YOUR NEXT RIVAL</span><h2>${waiting ? (state.room ? '找到球友，准备开拍。' : '寻找下一位对手。') : '来一场，认真过招。'}</h2><p>优先匹配积分接近的真人，等待后逐步扩大范围。${competition.state.profile ? `当前 ${competition.state.profile.elo} Elo。` : '先关联 B站云档，跨设备保留战绩。'}</p><p>开赛后主动退出判负；断线有 20 秒重连，后台暂停最多 60 秒。</p><button class="primary-button" data-action="${waiting ? 'cancel-queue' : 'ranked'}">${waiting ? '取消匹配，回到单人' : '开始匹配 ↗'}</button><button class="text-button" data-action="ranks">查看天梯 ↗</button>`);
      return;
    }
    if (!state.room) {
      setOverlay(`<span class="ticket-kicker">A TABLE FOR TWO</span><h2>${state.phase === 'connecting' ? '连接球桌…' : '等一位球友。'}</h2><p>创建房间，或输入朋友发来的六位房间码。</p><button class="primary-button" data-action="online">打开好友对战 ↗</button><button class="text-button" data-action="solo">回到单人练习</button>`);
    } else {
      const self = state.room.players.find(player => player.slot === state.slot);
      setOverlay(`<span class="ticket-kicker">ROOM ${state.room.code}</span><h2>${state.room.players.length < 2 ? '等朋友来接招。' : '两位，都准备好了吗？'}</h2><p>${state.room.players.length < 2 ? '把房间码发给朋友，加入后双方准备。' : '各自控制蓝方，先到五分。'}</p><button class="primary-button" data-action="ready" ${self?.ready && self.active ? 'disabled' : ''}>${self?.ready && self.active ? '等对方准备…' : '我准备好了'}</button><button class="text-button" data-action="copy-room">复制房间码</button>`);
    }
    return;
  }
  overlay.classList.toggle('hidden', phase === 'playing');
  if (phase === 'ready') {
    setOverlay(`<span class="ticket-kicker">A LITTLE MATCH, JUST FOR YOU</span><h2>准备好开拍了吗？</h2><p>鼠标、触屏，或者 WASD。先得 ${RINK.winningScore} 分，拿下这张桌。</p><button class="primary-button" data-action="start">开始这局 <span>↗</span></button>`);
  } else if (phase === 'countdown') {
    const number = Math.max(1, Math.ceil(game.timer));
    setOverlay(`<span class="countdown-number">${number}</span><span class="countdown-label">${number === 1 ? '准备接球' : '球桌即将开拍'}</span>`);
  } else if (phase === 'paused') {
    const self = onlineMode && online.state.room?.players.find(player => player.slot === online.state.slot);
    setOverlay(onlineMode
      ? `<span class="ticket-kicker">PAUSED TOGETHER</span><h2>球桌等你们回来。</h2><p>一方切到后台时双方暂停，比分和房间都会保留。</p><button class="primary-button" data-action="online-resume" ${self?.active ? 'disabled' : ''}>${self?.active ? '等球友回到球桌…' : '回到球桌 ↗'}</button>`
      : `<span class="ticket-kicker">PAUSED</span><h2>先喘口气。</h2><p>球桌停在这里。准备好后继续。</p><button class="primary-button" data-action="resume">继续比赛 <span>↗</span></button>`);
  } else if (phase === 'goal') {
    setOverlay(`<span class="ticket-kicker">${game.lastScorer === 'player' ? 'POINT FOR YOU' : 'POINT FOR OPPONENT'}</span><h2>${game.lastScorer === 'player' ? '漂亮！' : '下一球。'}</h2><p>比分 ${game.score.player} : ${game.score.computer} · ${game.serveTo === 'player' ? '你发球' : '对方发球'}</p>`);
  } else if (phase === 'finished') {
    const won = localWinner() === 'player';
    if (rankedMode) {
      const state = online.state, room = state.room;
      const rating = state.ratedResult;
      const pending = room?.settling || room?.settlementError || !rating;
      const detail = room?.voidPending ? '正在取消这场尚未完成的对局，不计分。'
        : room?.settlementError ? '战绩正在重试保存，确认后再开始下一局。'
          : rating ? `本局 ${rating.delta >= 0 ? '+' : ''}${rating.delta} Elo · 当前 ${rating.profile.elo} Elo${room?.finishReason !== 'score' ? ' · 离场结算' : ''}` : '正在确认双方战绩…';
      setOverlay(`<span class="ticket-kicker">RANKED RESULT · ${game.score.player} : ${game.score.computer}</span><h2>${room?.voidPending ? '球桌正在收拾。' : won ? '这一局，你拿下了。' : '下一局，再接招。'}</h2><p>${detail}</p><button class="primary-button" data-action="ranked" ${pending ? 'disabled' : ''}>继续匹配 ↗</button>${room?.settlementError ? '<button class="text-button" data-action="retry-rating">重试保存战绩</button>' : ''}<button class="text-button" data-action="ranks">查看天梯 ↗</button><button class="text-button" data-action="share">保存战绩图 ↓</button>`);
      return;
    }
    const ready = onlineMode && online.state.room?.players.find(player => player.slot === online.state.slot)?.ready;
    setOverlay(`<span class="ticket-kicker">FINAL SCORE · ${game.score.player} : ${game.score.computer}</span><h2>${won ? '这局，你拿下了。' : '差一点，下一局。'}</h2><p>本局最高连击 ×${matchBestCombo} · ${onlineMode ? '好友对战' : levelNames[selectedLevel] + '难度'}</p><button class="primary-button" data-action="${onlineMode ? 'ready' : 'restart'}" ${ready ? 'disabled' : ''}>${ready ? '等对方准备…' : '再来一局 ↗'}</button>${onlineMode ? '' : '<button class="text-button" data-action="ranks">提交成绩 / 查看榜单 ↗</button>'}<button class="text-button" data-action="share">保存战绩图 ↓</button>`);
  }
}

function updateScoreboard() {
  $('#player-score').textContent = game.score.player;
  $('#computer-score').textContent = game.score.computer;
  const modeLabel = rankedMode ? '02 / 排位对战' : onlineMode ? '02 / 好友对战' : '01 / 单人对战';
  const heading = $('.arena-topline > span:first-child');
  if (heading.textContent !== modeLabel) heading.textContent = modeLabel;
  $('#match-label').textContent = rankedMode ? `先得 5 分 · ${competition.state.profile?.elo ?? 1000} Elo`
    : onlineMode ? '先得 5 分 · 好友房间' : `先得 5 分 · ${levelNames[selectedLevel]}难度`;
  $('#restart').setAttribute('aria-label', rankedMode ? '退出本局并重新匹配，已开始的排位按退出判负' : '重新开始');
  const active = game.phase === 'playing';
  $('#pause').disabled = onlineMode || ['ready', 'finished'].includes(game.phase);
  $('#pause').textContent = game.phase === 'paused' ? '▶' : 'Ⅱ';
  $('#status-dot').classList.toggle('live', active);
  const status = {
    ready: '球桌就绪，等你开拍', countdown: '准备接球', playing: '比赛进行中', paused: '比赛已暂停', goal: '进球！下一球马上开始', finished: '比赛结束',
  }[game.phase];
  $('#status-text').textContent = onlineMode ? (online.state.error || (rankedMode && online.state.phase === 'queue' ? '正在按 Elo 匹配，等待真人对手'
    : rankedMode && online.state.room?.settling ? '正在保存排位战绩'
      : !online.state.room?.started && game.phase !== 'finished' ? (rankedMode ? '排位球桌就绪，等待开始匹配' : '等待球友和双方准备')
        : `${rankedMode ? '排位' : '房间'} ${online.state.room?.code || ''} · ${status}`)) : status;
  const rallyText = active ? `${game.rally} 拍 · ${levelNames[selectedLevel]}模式` : `本局最长 ${game.stats.longestRally} 拍`;
  $('#rally-label').textContent = rallyText;
}

function startGame() {
  if (onlineMode) return;
  setupAudio();
  practiceMatchId = newMatchId();
  goodShotCombo = 0;
  matchBestCombo = 0;
  rankings.clearResult();
  game.start(selectedLevel);
  trail.length = 0;
  particles.length = 0;
  feedbacks.length = 0;
  impacts.length = 0;
  screenShake = 0;
  renderOverlay();
  updateScoreboard();
  canvas.focus({ preventScroll: true });
}

function restartToReady() {
  haptics.cancel();
  haptics.play('restart');
  game.reset();
  goodShotCombo = 0;
  matchBestCombo = 0;
  rankings.clearResult();
  trail.length = 0;
  particles.length = 0;
  feedbacks.length = 0;
  impacts.length = 0;
  screenShake = 0;
  renderOverlay();
  updateScoreboard();
}

function togglePause() {
  if (onlineMode) return;
  if (game.phase === 'paused') { setupAudio(); game.resume(); }
  else game.pause();
  renderOverlay();
  updateScoreboard();
}

function updateOnlineState(state) {
  if (state.accountProfile !== lastOnlineProfile) {
    lastOnlineProfile = state.accountProfile;
    if (state.accountProfile) competition.updateProfile(state.accountProfile);
  }
  if (!onlineMode) return;
  if (rankedMode && state.room?.phase === 'finished') game.phase = 'finished';
  const opponent = state.room?.players.find(player => player.slot !== state.slot);
  if (rankedMode && opponent?.alias) $('.computer-team div').firstChild.textContent = opponent.alias;
  if (rankedMode && state.phase !== 'room' && state.room) game.phase = 'paused';
  $('#online-status').textContent = state.error || (state.room ? `房间 ${state.room.code} · ${state.room.players.length}/2 人` : state.phase === 'connecting' ? '正在连接球桌…' : online.configured ? '创建一张球桌，或加入朋友的房间。' : '好友对战服务还未上线，你可以先玩单人模式。');
  $('#create-room').disabled = !online.configured || state.phase === 'connecting' || Boolean(state.room);
  $('#join-room button').disabled = $('#create-room').disabled;
  $('#room-info').hidden = !state.room;
  $('#room-code-display').textContent = state.room?.code || '';
  const self = state.room?.players.find(player => player.slot === state.slot);
  $('#ready-room').disabled = Boolean((self?.ready && self.active) || state.room?.started);
  $('#ready-room').textContent = self?.ready && self.active ? '等对方准备…' : '我准备好了';
  if (state.room && $('#online-dialog').open) $('#online-dialog').close();
  if (!state.room || (!state.room.started && game.phase !== 'finished')) {
    game.phase = 'ready'; onlineTarget = null; onlineEvents.length = 0;
  }
  renderOverlay(); updateScoreboard();
}

function applyOnlineSnapshot(snapshot, slot) {
  if (!onlineMode || slot === null) return;
  const previous = game.phase;
  game.phase = snapshot.phase; game.timer = snapshot.timer;
  game.score = slot === 1 ? { player: snapshot.score.computer, computer: snapshot.score.player } : { ...snapshot.score };
  game.serveTo = online.localSide(snapshot.serveTo, slot);
  game.lastScorer = snapshot.lastScorer ? online.localSide(snapshot.lastScorer, slot) : null;
  game.rally = snapshot.rally;
  game.stats = { ...snapshot.stats, ...snapshot.stats.players[slot] };
  onlineTarget = { puck: online.localPoint(snapshot.puck, slot), computer: online.localPoint(snapshot.players[1 - slot], slot) };
  if (previous !== game.phase || game.phase !== 'playing') {
    Object.assign(game.player, online.localPoint(snapshot.players[slot], slot));
    Object.assign(game.puck, onlineTarget.puck); Object.assign(game.computer, onlineTarget.computer);
  }
  for (const name of ['puck', 'computer']) {
    game[name].vx = onlineTarget[name].vx; game[name].vy = onlineTarget[name].vy;
  }
  for (const event of onlineEvents.splice(0)) {
    if (event.type === 'start') { goodShotCombo = 0; matchBestCombo = 0; rankings.clearResult(); }
    handleEvent(event);
  }
  renderOverlay(); updateScoreboard();
}

function setOnlineView(ranked) {
  keys.clear();
  if (!onlineMode || rankedMode !== ranked) {
    game.pause(); onlineMode = true; rankedMode = ranked; restartToReady();
    $('#solo-button').setAttribute('aria-pressed', 'false');
    $('#online-button').setAttribute('aria-pressed', String(!ranked));
    $('#ranked-button').setAttribute('aria-pressed', String(ranked));
    $('.computer-team small').textContent = ranked ? 'RIVAL' : 'FRIEND';
    $('.computer-team div').firstChild.textContent = '球友';
    document.querySelectorAll('[data-level]').forEach(button => { button.disabled = true; });
  }
}

function openOnline() {
  modeEpoch += 1; matchingEpoch = 0;
  if (rankedMode) online.leave();
  setOnlineView(false);
  updateOnlineState(online.state);
  if (!$('#online-dialog').open) $('#online-dialog').showModal();
}

async function beginRanked() {
  if (rankedMode && (matchingEpoch || online.state.phase === 'queue' || online.state.room?.started)) return;
  const epoch = ++modeEpoch; matchingEpoch = epoch;
  online.leave(); setOnlineView(true); restartToReady();
  stage.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if ($('#online-dialog').open) $('#online-dialog').close();
  setupAudio(); renderOverlay();
  try {
    const token = await competition.credential();
    if (epoch !== modeEpoch || !rankedMode) return;
    await online.queue(token);
  } catch (error) {
    if (epoch !== modeEpoch) return;
    if (error.code !== 'cancelled') showToast(error.message);
    if (!competition.state.profile) openAccount();
  } finally {
    if (matchingEpoch === epoch) matchingEpoch = 0;
    renderOverlay(); updateScoreboard();
  }
}

function returnSolo() {
  modeEpoch += 1; matchingEpoch = 0;
  onlineMode = false; rankedMode = false; online.leave(); onlineTarget = null; onlineEvents.length = 0;
  $('#solo-button').setAttribute('aria-pressed', 'true'); $('#online-button').setAttribute('aria-pressed', 'false');
  $('#ranked-button').setAttribute('aria-pressed', 'false');
  $('.computer-team small').textContent = 'COMPUTER'; $('.computer-team div').firstChild.textContent = '电脑';
  document.querySelectorAll('[data-level]').forEach(button => { button.disabled = false; });
  if ($('#online-dialog').open) $('#online-dialog').close();
  restartToReady();
}

async function roomAction(action) {
  setupAudio();
  try { await action(); }
  catch (error) { if (error.code !== 'cancelled') $('#online-status').textContent = error.message || '暂时无法连接，请稍后再试。'; }
}

function pauseForDialog() {
  keys.clear();
  if (onlineMode) pauseOnline(); else game.pause();
}

function pauseOnline() {
  if (rankedMode && matchingEpoch && !online.state.room) { modeEpoch += 1; matchingEpoch = 0; }
  online.setActive(false);
}

function openAccount() {
  pauseForDialog(); updateIdentity(competition.state);
  if (!$('#account-dialog').open) $('#account-dialog').showModal();
}

function updateIdentity(state) {
  const profile = state.profile;
  if (profile !== lastIdentityProfile) { lastIdentityProfile = profile; rankings?.invalidate(); }
  $('#rank-account').textContent = profile ? `${profile.alias} · ${profile.elo} Elo` : '关联云档，跨设备留住战绩。';
  $('#account-button').textContent = profile ? '云档 / 关联设备 ↗' : '关联 B站云档 ↗';
  $('#account-profile').textContent = profile ? `${profile.alias} · ${profile.elo} Elo` : '';
  $('#account-status').textContent = state.error || (state.phase === 'loading' ? '正在连接云档…' : state.phase === 'awaiting' ? '等待你在 B站 Toy 批准这台设备。'
    : profile ? '云档已关联，战绩会跟随这个赛号。' : competition.isToy() ? '登录 B站后点下面的按钮，创建或读回你的游戏云档。' : '用 B站 Toy 批准一次授权码，将这台设备关联到你的游戏云档。');
  $('#connect-account').hidden = Boolean(profile && competition.isToy());
  $('#connect-account').disabled = ['loading', 'awaiting'].includes(state.phase);
  $('#connect-account').textContent = competition.isToy() ? '关联 B站云档 ↗' : profile ? '关联另一个云档 ↗' : '用 B站云档登录 ↗';
  $('#device-link').hidden = !state.pair;
  $('#device-code').textContent = state.pair?.code || '';
  $('#open-toy-auth').href = `https://www.bilibili.com/toy/yi-pai-ji-he-air-hockey/index.html${state.pair ? `?link=${state.pair.code}` : ''}`;
  $('#approve-link').hidden = !competition.isToy() || !profile;
}

function localWinner() {
  const winner = rankedMode && online.state.room?.resultWinner;
  return winner === 0 || winner === 1 ? (winner === online.state.slot ? 'player' : 'computer') : game.lastScorer;
}

async function copyRoom() {
  const code = online.state.room?.code;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); showToast(`房间码 ${code} 已复制，发给朋友来接招。`); }
  catch { showToast(`请把房间码 ${code} 发给朋友。`); }
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function toggleFullscreen() {
  try {
    if (window.AirHockeyNative?.setFullscreen) {
      window.AirHockeyNative.setFullscreen(!nativeFullscreen);
      return;
    }
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
      return;
    }
    const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!request) { showToast('当前浏览器不支持全屏模式。'); return; }
    await request.call(document.documentElement);
  } catch {
    showToast('浏览器没有允许全屏，请使用地址栏或系统菜单进入。');
  }
}

function updateFullscreenButton() {
  const active = nativeFullscreen || Boolean(fullscreenElement());
  document.documentElement.classList.toggle('immersive', active);
  const button = $('#fullscreen');
  button.textContent = active ? '×' : '⛶';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  button.title = active ? '退出全屏' : '进入全屏';
  resizeCanvas();
}

window.airHockeyNativeFullscreen = (active) => {
  nativeFullscreen = Boolean(active);
  updateFullscreenButton();
};
window.airHockeyNativePause = () => {
  keys.clear();
  pointerActive = false;
  if (onlineMode) pauseOnline();
  else game.pause();
  haptics.cancel();
  audioContext?.suspend();
};
window.airHockeyNativeSaved = (saved, message) => showToast(message || (saved ? '战绩图已保存。' : '没有保存成功，请再试一次。'));
window.airHockeyNativeAuthFailed = () => showToast('请在 B站 Toy 打开一拍即合，并输入这台设备的授权码。');
if (window.AirHockeyNative) document.documentElement.classList.add('native-app');

function setupAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
  if (!sfx) sfx = createSfx(audioContext, { level: .6 }); // ≈ −4 dB: collisions sit above, not over, serve/goal cues
}

function getNoiseBuffer() {
  if (noiseBuffer || !audioContext) return noiseBuffer;
  noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 1.5, audioContext.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function playVoice({ start, end = start, duration = .1, type = 'sine', level = .08, at = 0, pan = 0 }) {
  if (!soundOn) return;
  try {
    setupAudio();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const when = audioContext.currentTime + at;
    oscillator.type = type; oscillator.frequency.setValueAtTime(start, when); oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), when + duration);
    gain.gain.setValueAtTime(.0001, when); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level), when + .006); gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    const output = pan ? audioContext.createStereoPanner() : null;
    if (output) output.pan.value = pan;
    oscillator.connect(gain); if (output) gain.connect(output).connect(audioContext.destination); else gain.connect(audioContext.destination);
    oscillator.start(when); oscillator.stop(when + duration + .02);
  } catch { /* browsers may block audio until a gesture */ }
}

function playNoise({ duration = .05, frequency = 1800, q = 1.8, gain = .04, at = 0, pan = 0 }) {
  if (!soundOn) return;
  try {
    setupAudio();
    const source = audioContext.createBufferSource(); source.buffer = getNoiseBuffer();
    const filter = audioContext.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
    const outputGain = audioContext.createGain(); const when = audioContext.currentTime + at;
    outputGain.gain.setValueAtTime(.0001, when); outputGain.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), when + .003); outputGain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    const output = pan ? audioContext.createStereoPanner() : null; if (output) output.pan.value = pan;
    source.connect(filter).connect(outputGain); if (output) outputGain.connect(output).connect(audioContext.destination); else outputGain.connect(audioContext.destination);
    source.start(when); source.stop(when + duration + .01);
  } catch { /* browsers may block audio until a gesture */ }
}

function playHitSound(event, pitch = 1) {
  if (!soundOn) return;
  try { setupAudio(); sfx.hit({ speed: event.speed, x: event.x, side: event.side, pitch }); } catch { /* browsers may block audio until a gesture */ }
}

const POSTS = [[0, 180], [0, 380], [1000, 180], [1000, 380]];

function playWallSound(event) {
  if (!soundOn) return;
  try {
    setupAudio();
    const speed = Math.hypot(game.puck.vx, game.puck.vy);
    // A puck sliding along a rail reports a contact every physics step; voice only distinct knocks.
    if (audioContext.currentTime - lastWallSound < .045 && speed < 500) return;
    lastWallSound = audioContext.currentTime;
    const nearPost = POSTS.some(([x, y]) => Math.hypot(event.x - x, event.y - y) <= RINK.puckRadius + RINK.postRadius + 1.5);
    sfx[nearPost ? 'post' : 'wall']({ speed, x: event.x });
  } catch { /* browsers may block audio until a gesture */ }
}

function playServeSound() {
  playVoice({ start: 360, end: 470, duration: .09, type: 'sine', level: .035 });
  playVoice({ start: 540, end: 660, duration: .12, type: 'sine', level: .028, at: .075 });
}

function playGoalSound(playerScored) {
  const root = playerScored ? 390 : 180;
  playVoice({ start: root, end: root * .9, duration: .14, type: 'triangle', level: .07 });
  playVoice({ start: root * 1.25, end: root * 1.08, duration: .18, type: 'triangle', level: .055, at: .11 });
  playVoice({ start: root * 1.5, end: root * 1.32, duration: .24, type: 'sine', level: .045, at: .22 });
  playNoise({ duration: .11, frequency: playerScored ? 900 : 420, q: 1.2, gain: .035, at: .015 });
}

function playFinishSound(playerWon) {
  const notes = playerWon ? [440, 554, 659, 880] : [240, 205, 160];
  notes.forEach((note, index) => playVoice({ start: note, end: note * .98, duration: playerWon ? .19 : .24, type: playerWon ? 'sine' : 'triangle', level: playerWon ? .05 : .04, at: index * (playerWon ? .12 : .16) }));
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const { scale, offsetX, offsetY } = viewMetrics(rect);
  const viewX = (event.clientX - rect.left - offsetX) / scale;
  const viewY = (event.clientY - rect.top - offsetY) / scale;
  return portraitView ? { x: RINK.width - viewY, y: viewX } : { x: viewX, y: viewY };
}

function viewMetrics(rect) {
  const width = portraitView ? RINK.height : RINK.width;
  const height = portraitView ? RINK.width : RINK.height;
  const scale = Math.min(rect.width / width, rect.height / height);
  return { scale, offsetX: (rect.width - width * scale) / 2, offsetY: (rect.height - height * scale) / 2 };
}

function setPointerTarget(event) {
  const point = canvasPoint(event);
  game.setTarget(point.x, point.y);
}

function updateKeyboard(dt) {
  if (game.phase !== 'playing' && game.phase !== 'countdown') return;
  const x = (keys.has('arrowleft') || keys.has('a') ? -1 : 0) + (keys.has('arrowright') || keys.has('d') ? 1 : 0);
  const y = (keys.has('arrowup') || keys.has('w') ? -1 : 0) + (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
  if (!x && !y) return;
  game.setTarget(game.target.x + x * 720 * dt, game.target.y + y * 720 * dt);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  portraitView = rect.height > rect.width;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}

function render() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { scale, offsetX, offsetY } = viewMetrics(rect);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
  if (portraitView) { ctx.translate(0, RINK.width); ctx.rotate(-Math.PI / 2); }
  const shake = screenShake * 7;
  ctx.translate(Math.sin(visualTime * 77) * shake, Math.cos(visualTime * 61) * shake * .7);
  ctx.clearRect(0, 0, RINK.width, RINK.height);
  const bg = ctx.createLinearGradient(0, 0, RINK.width, RINK.height);
  bg.addColorStop(0, '#1b6871'); bg.addColorStop(.5, '#17616b'); bg.addColorStop(1, '#134e58');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, RINK.width, RINK.height);
  ctx.save(); ctx.globalAlpha = .13; ctx.strokeStyle = '#b4f4e7'; ctx.lineWidth = 1;
  for (let x = 30; x < RINK.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RINK.height); ctx.stroke(); }
  for (let y = 20; y < RINK.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(RINK.width, y); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(180,244,231,.55)'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 992, 552);
  ctx.strokeStyle = 'rgba(244,243,233,.53)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(500, 4); ctx.lineTo(500, 556); ctx.stroke();
  ctx.beginPath(); ctx.arc(500, 280, 78, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(500, 280, 5, 0, Math.PI * 2); ctx.fillStyle = '#f2bd45'; ctx.fill();
  drawGoal('left', 0, '#9ce5d9'); drawGoal('right', 1000, '#ef765c');
  for (const point of trail) { const life = Math.max(0.04, point.life); ctx.globalAlpha = life * .34; ctx.beginPath(); ctx.arc(point.x, point.y, RINK.puckRadius * life, 0, Math.PI * 2); ctx.fillStyle = '#f2bd45'; ctx.fill(); }
  ctx.globalAlpha = 1;
  drawMallet(game.player, '#9ce5d9', '#137985', 'YOU'); drawMallet(game.computer, '#ef765c', '#a4413e', onlineMode ? 'RIVAL' : 'CPU'); drawPuck(game.puck);
  for (const impact of impacts) drawImpact(impact);
  for (const feedback of feedbacks) drawGraffitiFeedback(feedback);
  for (const particle of particles) { const alpha = Math.max(0, particle.life / particle.max); ctx.globalAlpha = alpha; ctx.strokeStyle = particle.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size * (1.4 - alpha), 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function drawImpact(impact) {
  const progress = 1 - Math.max(0, impact.life / impact.max);
  const radius = 27 + progress * (impact.heavy ? 80 : 52);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress) * .78;
  ctx.strokeStyle = impact.color; ctx.lineWidth = impact.heavy ? 5 : 3;
  ctx.beginPath(); ctx.arc(impact.x, impact.y, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = Math.max(0, 1 - progress) * (impact.heavy ? .9 : .65);
  ctx.strokeStyle = '#f4f3e9'; ctx.lineWidth = 2;
  for (let index = 0; index < (impact.heavy ? 14 : 9); index += 1) {
    const angle = index * Math.PI * 2 / (impact.heavy ? 14 : 9) + visualTime * .7;
    const inner = radius * .72, outer = radius + (impact.heavy ? 22 : 13);
    ctx.beginPath(); ctx.moveTo(impact.x + Math.cos(angle) * inner, impact.y + Math.sin(angle) * inner); ctx.lineTo(impact.x + Math.cos(angle) * outer, impact.y + Math.sin(angle) * outer); ctx.stroke();
  }
  ctx.restore();
}

function drawGraffitiFeedback(feedback) {
  const progress = 1 - Math.max(0, feedback.life / feedback.max);
  const alpha = Math.pow(Math.max(0, Math.min(1, feedback.life / feedback.max)), .42);
  const lift = progress * (feedback.heavy ? 32 : 21);
  const wobble = Math.sin(visualTime * 12 + feedback.x) * (feedback.heavy ? 2.2 : 1.3);
  ctx.save();
  ctx.translate(feedback.x + wobble, feedback.y - lift);
  ctx.rotate((portraitView ? Math.PI / 2 : 0) + (feedback.flip ? -1 : 1) * (-.07 + Math.sin(visualTime * 7 + feedback.y) * .025));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#162b32'; ctx.lineWidth = feedback.heavy ? 7 : 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  const rays = feedback.heavy ? 12 : 9;
  for (let index = 0; index < rays; index += 1) {
    const angle = index * Math.PI * 2 / rays + .18;
    const start = feedback.heavy ? 43 : 34, end = start + (index % 2 ? 12 : 20);
    ctx.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
    ctx.lineTo(Math.cos(angle) * end, Math.sin(angle) * end);
  }
  ctx.stroke();
  ctx.font = `${feedback.heavy ? 900 : 700} ${feedback.heavy ? 43 : 35}px Noto Serif SC, serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = feedback.heavy ? 7 : 5; ctx.strokeStyle = '#162b32'; ctx.strokeText(feedback.text, 0, 0);
  ctx.fillStyle = feedback.color; ctx.fillText(feedback.text, 0, 0);
  ctx.strokeStyle = feedback.color; ctx.lineWidth = feedback.heavy ? 5 : 4;
  ctx.beginPath(); ctx.moveTo(-41, 29); ctx.quadraticCurveTo(-10, 38, 18, 28); ctx.quadraticCurveTo(39, 21, 50, 30); ctx.stroke();
  if (feedback.heavy) {
    ctx.globalAlpha = alpha * .85; ctx.strokeStyle = '#f2bd45'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(58, -13); ctx.lineTo(72, -24); ctx.moveTo(63, -1); ctx.lineTo(80, -2); ctx.stroke();
  }
  ctx.restore();
}

function drawGoal(side, x, color) {
  ctx.save(); ctx.fillStyle = 'rgba(4,27,31,.7)'; ctx.strokeStyle = color; ctx.lineWidth = 4;
  const left = side === 'left' ? -12 : 912;
  roundedRect(ctx, left, 180, 100, 200, 19); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = .72; ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let y = 190; y < 380; y += 15) { ctx.beginPath(); ctx.moveTo(left + 12, y); ctx.lineTo(left + 88, y); ctx.stroke(); }
  ctx.restore();
  if (!portraitView) { ctx.fillStyle = color; ctx.globalAlpha = .65; ctx.font = '500 11px DM Mono, monospace'; ctx.textAlign = side === 'left' ? 'left' : 'right'; ctx.fillText(side === 'left' ? 'YOU' : 'CPU', side === 'left' ? 20 : 980, 165); ctx.globalAlpha = 1; }
}

function drawMallet(mallet, outer, inner, label) {
  ctx.save(); ctx.shadowColor = 'rgba(3,23,28,.34)'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 8;
  ctx.beginPath(); ctx.arc(mallet.x, mallet.y, RINK.malletRadius, 0, Math.PI * 2); ctx.fillStyle = outer; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.beginPath(); ctx.arc(mallet.x, mallet.y, RINK.malletRadius * .67, 0, Math.PI * 2); ctx.fillStyle = inner; ctx.fill();
  ctx.beginPath(); ctx.arc(mallet.x - 9, mallet.y - 10, RINK.malletRadius * .19, 0, Math.PI * 2); ctx.fillStyle = 'rgba(244,243,233,.76)'; ctx.fill();
  if (!portraitView) { ctx.fillStyle = 'rgba(22,43,50,.7)'; ctx.font = '500 8px DM Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(label, mallet.x, mallet.y + 3); } ctx.restore();
}

function drawPuck(puck) {
  ctx.save(); ctx.shadowColor = '#f2bd45'; ctx.shadowBlur = 17; ctx.beginPath(); ctx.arc(puck.x, puck.y, RINK.puckRadius, 0, Math.PI * 2); ctx.fillStyle = '#f2bd45'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.beginPath(); ctx.arc(puck.x - 4, puck.y - 5, 5, 0, Math.PI * 2); ctx.fillStyle = '#fff4bd'; ctx.fill(); ctx.restore();
}

function makeResultCard(winner) {
  const card = document.createElement('canvas'); card.width = 1200; card.height = 900;
  const c = card.getContext('2d'); c.fillStyle = '#f4f3e9'; c.fillRect(0, 0, card.width, card.height);
  c.strokeStyle = 'rgba(22,43,50,.11)'; c.lineWidth = 1;
  for (let x = 0; x < 1200; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 900); c.stroke(); }
  for (let y = 0; y < 900; y += 50) { c.beginPath(); c.moveTo(0, y); c.lineTo(1200, y); c.stroke(); }
  c.fillStyle = '#162b32'; c.font = '700 26px DM Mono, monospace'; c.fillText('AIR HOCKEY CLUB  /  VOL. 01', 78, 88);
  c.fillStyle = winner === 'player' ? '#0d5864' : '#a4413e'; c.font = '900 80px Noto Serif SC, serif'; c.fillText(winner === 'player' ? '这一拍，你赢了。' : '下一拍，赢回来。', 78, 190);
  c.fillStyle = '#162b32'; c.font = '500 20px DM Mono, monospace'; c.fillText(`${levelNames[selectedLevel].toUpperCase()} MODE  ·  FIRST TO ${RINK.winningScore}`, 82, 232);
  c.fillStyle = '#17616b'; roundedRect(c, 78, 294, 1044, 375, 16); c.fill();
  c.strokeStyle = 'rgba(180,244,231,.5)'; c.lineWidth = 4; c.strokeRect(92, 308, 1016, 347); c.strokeStyle = 'rgba(244,243,233,.45)'; c.beginPath(); c.moveTo(600, 308); c.lineTo(600, 655); c.stroke();
  c.fillStyle = '#f4f3e9'; c.font = '500 26px Noto Serif SC, serif'; c.fillText('你', 278, 365); c.fillText(onlineMode ? '球友' : '电脑', 865, 365);
  c.font = '900 130px DM Mono, monospace'; c.fillStyle = '#9ce5d9'; c.fillText(String(game.score.player), 245, 505); c.fillStyle = '#ef765c'; c.fillText(String(game.score.computer), 835, 505); c.fillStyle = '#f2bd45'; c.font = '500 56px DM Mono, monospace'; c.fillText(':', 578, 505);
  c.fillStyle = '#f4f3e9'; c.font = '500 20px DM Mono, monospace'; c.fillText(`RALLY ${game.stats.longestRally}  ·  BEST SHOT ${Math.round(game.stats.fastestShot)} PX/S`, 255, 595);
  c.fillStyle = '#162b32'; c.font = '600 24px Noto Serif SC, serif'; c.fillText('一拍即合 · 来自你的浏览器战绩', 78, 760); c.fillStyle = '#6e7a78'; c.font = '500 17px DM Mono, monospace'; c.fillText('PLAY IT. FEEL IT. SHARE IT.', 78, 800);
  const url = card.toDataURL('image/png'); $('#result-image').src = url; $('#download-card').href = url;
}

function openShareDialog() { if (game.phase === 'finished') { makeResultCard(localWinner()); $('#share-dialog').showModal(); } }

document.querySelectorAll('[data-level]').forEach((button) => button.addEventListener('click', () => { if (game.phase === 'ready') haptics.play('select'); setLevel(button.dataset.level); }));
$('#overlay').addEventListener('click', (event) => { const action = event.target.closest('[data-action]')?.dataset.action; if (action === 'start' || action === 'restart') startGame(); if (action === 'resume') togglePause(); if (action === 'share') openShareDialog(); if (action === 'ready') { setupAudio(); online.ready(); } if (action === 'online-resume') { setupAudio(); online.setActive(true); } if (action === 'copy-room') void copyRoom(); if (action === 'online') openOnline(); if (action === 'solo' || action === 'cancel-queue') returnSolo(); if (action === 'ranked') void beginRanked(); if (action === 'retry-rating') online.retrySettlement(); if (action === 'ranks') rankings.open(selectedLevel, rankedMode ? 'ranked' : 'solo'); });
$('#pause').addEventListener('click', togglePause);
$('#solo-button').addEventListener('click', () => { if (onlineMode) returnSolo(); });
$('#online-button').addEventListener('click', openOnline);
$('#ranked-button').addEventListener('click', () => void beginRanked());
$('#leaderboard-button').addEventListener('click', () => rankings.open(selectedLevel, rankedMode ? 'ranked' : 'solo'));
$('#connect-account').addEventListener('click', async () => {
  try {
    if (competition.isToy()) { await competition.ensureIdentity(); await competition.flushPractice(); }
    else {
      const pair = await competition.startLink();
      if (pair && !document.hidden && $('#account-dialog').open && window.AirHockeyNative?.openToyAuthorization) window.AirHockeyNative.openToyAuthorization(pair.code);
    }
  }
  catch (error) { $('#account-status').textContent = error.message; }
});
$('#open-toy-auth').addEventListener('click', event => {
  if (window.AirHockeyNative?.openToyAuthorization && competition.state.pair) {
    event.preventDefault(); window.AirHockeyNative.openToyAuthorization(competition.state.pair.code);
  }
});
$('#cancel-link').addEventListener('click', () => competition.cancelLink());
$('#account-dialog').addEventListener('close', () => competition.cancelLink());
$('#approve-link').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#approve-link button'); button.disabled = true;
  try { await competition.approveLink($('#device-approval-code').value); $('#device-approval-code').value = ''; $('#account-status').textContent = '已批准，这台设备可以读回同一份战绩。'; }
  catch (error) { $('#account-status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#create-room').addEventListener('click', () => void roomAction(() => online.create()));
$('#join-room').addEventListener('submit', event => { event.preventDefault(); void roomAction(() => online.join($('#room-code').value.trim().toUpperCase())); });
$('#ready-room').addEventListener('click', () => { setupAudio(); online.ready(); });
$('#copy-room').addEventListener('click', () => void copyRoom());
$('#leave-room').addEventListener('click', () => online.leave());
$('#return-solo').addEventListener('click', returnSolo);
$('#fullscreen').addEventListener('click', () => { haptics.play('fullscreen'); void toggleFullscreen(); });
$('#restart').addEventListener('click', () => { if (rankedMode) { online.leave(); void beginRanked(); } else if (onlineMode) { online.leave(); openOnline(); } else if (game.phase === 'finished') startGame(); else restartToReady(); });
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
$('#download-card').addEventListener('click', (event) => {
  if (window.AirHockeyNative?.saveImage) {
    event.preventDefault();
    window.AirHockeyNative.saveImage($('#result-image').src);
  }
});
document.querySelectorAll('.dialog-close, .dialog-close-button').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#sound').addEventListener('click', () => { soundOn = !soundOn; $('#sound').setAttribute('aria-pressed', String(soundOn)); $('#sound').setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效'); if (soundOn) { setupAudio(); playVoice({ start: 440, end: 560, duration: .09, level: .05 }); } });
hapticsButton.addEventListener('click', () => { hapticsOn = !hapticsOn; hapticsButton.setAttribute('aria-pressed', String(hapticsOn)); hapticsButton.setAttribute('aria-label', hapticsOn ? '关闭触感' : '开启触感'); hapticsButton.title = hapticsOn ? '关闭触感' : '开启触感'; haptics.setEnabled(hapticsOn); if (hapticsOn) haptics.play('toggle'); });
canvas.addEventListener('pointerdown', (event) => { pointerActive = true; canvas.setPointerCapture?.(event.pointerId); setPointerTarget(event); setupAudio(); });
canvas.addEventListener('pointermove', (event) => { if (event.pointerType === 'mouse' || pointerActive) setPointerTarget(event); });
canvas.addEventListener('pointerup', (event) => { pointerActive = false; canvas.releasePointerCapture?.(event.pointerId); });
canvas.addEventListener('pointercancel', () => { pointerActive = false; });
window.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || event.target?.closest?.('input,textarea,select,[contenteditable]')) { keys.clear(); return; }
  const key = event.key.toLowerCase();
  if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d',' '].includes(key)) event.preventDefault();
  if (key === ' ') { togglePause(); return; }
  keys.add(key); setupAudio();
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
const incomingDeviceCode = new URLSearchParams(location.search).get('link');
if (competition.isToy() && /^[A-Fa-f0-9]{6}$/.test(incomingDeviceCode || '')) {
  $('#device-approval-code').value = incomingDeviceCode.toUpperCase();
  queueMicrotask(openAccount);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { window.airHockeyNativePause(); renderOverlay(); updateScoreboard(); } });
window.addEventListener('resize', resizeCanvas);
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

function frame(now) {
  const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  visualTime += dt;
  screenShake = Math.max(0, screenShake - dt * 3.9);
  updateKeyboard(dt);
  if (onlineMode) {
    if (online.state.room?.started && ['playing', 'countdown'].includes(game.phase)) { game.followPlayer(dt); online.input(game.target.x, game.target.y); }
    if (onlineTarget) {
      const amount = 1 - Math.exp(-dt * 28);
      for (const name of ['puck', 'computer']) {
        for (const axis of ['x', 'y']) game[name][axis] += (onlineTarget[name][axis] - game[name][axis]) * amount;
      }
    }
  } else game.update(dt);
  const puck = game.puck; trail.unshift({ x: puck.x, y: puck.y, life: 1 }); if (trail.length > 10) trail.pop(); trail.forEach((point) => { point.life -= dt * 4.2; });
  for (let index = particles.length - 1; index >= 0; index -= 1) { particles[index].life -= dt; if (particles[index].life <= 0) particles.splice(index, 1); }
  for (let index = impacts.length - 1; index >= 0; index -= 1) { impacts[index].life -= dt; if (impacts[index].life <= 0) impacts.splice(index, 1); }
  for (let index = feedbacks.length - 1; index >= 0; index -= 1) { feedbacks[index].life -= dt; if (feedbacks[index].life <= 0) feedbacks.splice(index, 1); }
  render(); updateScoreboard();
  if (game.phase === 'countdown' || game.phase === 'goal') renderOverlay();
  requestAnimationFrame(frame);
}

$('#sound').setAttribute('aria-pressed', String(soundOn)); $('#sound').setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
if (haptics.available()) { hapticsButton.hidden = false; hapticsButton.setAttribute('aria-pressed', 'true'); hapticsButton.setAttribute('aria-label', '关闭触感'); hapticsButton.title = '关闭触感'; }
const cloudReady = loadToyRecord();
new ResizeObserver(resizeCanvas).observe(stage);
updateRecord(); setLevel('standard'); resizeCanvas(); updateFullscreenButton(); renderOverlay(); updateScoreboard(); requestAnimationFrame(frame);
