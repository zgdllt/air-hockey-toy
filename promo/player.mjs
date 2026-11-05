// Browser preview + recorder hooks for the promo film.
import { createDirector, DURATION, FPS } from './promo.mjs';
import { renderSoundtrack, toWav } from './audio.mjs';
import { toyUrl } from './toy.mjs';

const params = new URLSearchParams(location.search);
const canvas = document.querySelector('#film');
const ctx = canvas.getContext('2d');
const scrub = document.querySelector('#scrub');
const timeLabel = document.querySelector('#time');
const playButton = document.querySelector('#play');
const soundButton = document.querySelector('#sound');
const director = createDirector();
let playing = false, soundOn = true, startWall = 0, startT = 0, current = Number(params.get('t')) || 0;
let audioContext = null, soundtrackPromise = null, source = null, playToken = 0;

if (params.has('record')) document.body.classList.add('record');
scrub.max = String(DURATION);

function draw(t) {
  current = t;
  director.renderAt(ctx, t);
  scrub.value = String(t);
  timeLabel.textContent = `${t.toFixed(2)} s`;
}

async function ensureSoundtrack() {
  soundtrackPromise ||= renderSoundtrack(director.film);
  const buffer = await soundtrackPromise;
  if (!audioContext) audioContext = new AudioContext({ sampleRate: buffer.sampleRate });
  return buffer;
}

function stopAudio() { if (source) { try { source.stop(); } catch { /* already stopped */ } source = null; } }

async function play() {
  if (current >= DURATION - .01) current = 0;
  const token = ++playToken;
  playing = true; playButton.textContent = 'Ⅱ 暂停';
  if (soundOn) {
    let buffer;
    try { buffer = await ensureSoundtrack(); }
    catch (error) {
      // Drop the failed render so the next play retries, and leave the UI in a consistent paused state.
      console.error('soundtrack failed:', error); soundtrackPromise = null;
      if (token === playToken) pause();
      return;
    }
    await audioContext.resume();
    if (token !== playToken || !playing) return; // paused or restarted while the soundtrack was rendering
    stopAudio();
    source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination);
    source.start(0, current);
  }
  startWall = performance.now(); startT = current;
  requestAnimationFrame(tick);
}

function pause() { playToken += 1; playing = false; playButton.textContent = '▶ 播放'; stopAudio(); }

function tick(now) {
  if (!playing) return;
  const t = startT + (now - startWall) / 1000;
  if (t >= DURATION) { draw(DURATION); pause(); return; }
  draw(t);
  requestAnimationFrame(tick);
}

playButton.addEventListener('click', () => (playing ? pause() : play()));
soundButton.addEventListener('click', () => {
  soundOn = !soundOn; soundButton.setAttribute('aria-pressed', String(soundOn));
  soundButton.textContent = soundOn ? '♪ 有声' : '♪ 静音';
  if (!soundOn) stopAudio(); else if (playing) { pause(); play(); }
});
scrub.addEventListener('input', () => { const wasPlaying = playing; pause(); draw(Number(scrub.value)); if (wasPlaying) play(); });
window.addEventListener('keydown', (event) => {
  if (event.key === ' ') { event.preventDefault(); playing ? pause() : play(); }
  if (event.key === 'ArrowRight') { pause(); draw(Math.min(DURATION, current + 1 / FPS)); }
  if (event.key === 'ArrowLeft') { pause(); draw(Math.max(0, current - 1 / FPS)); }
});

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Recorder hooks (used by scripts/record.mjs through Playwright).
window.__promo = {
  duration: DURATION, fps: FPS, toyUrl: toyUrl(),
  ready: document.fonts.ready.then(() => { draw(current); return true; }),
  frame(t, type = 'image/png', quality) { director.renderAt(ctx, t); return canvas.toDataURL(type, quality); },
  async soundtrackWav() { return bytesToBase64(new Uint8Array(toWav(await renderSoundtrack(director.film)))); },
  events: director.film.events.map((e) => ({ type: e.type, side: e.side, sim: +(e.t - director.film.R0).toFixed(3), video: +e.video.toFixed(3), speed: Math.round(e.speed) })),
};
