// Offline soundtrack: the game's hit/wall voices placed on the film's collision
// times, plus a beat bed that follows the shot structure. Pure Web Audio.
import { createSfx } from '../sfx.mjs';
import { titlePuckBounces } from './overlay.mjs';
import { DURATION, TOY_START, VO_START } from './timeline.mjs';
import { BEATS } from './toycard.mjs';

const VOICE_URL = new URL('./assets/voiceover-toy.wav', import.meta.url);

const RATE = 48000;

/** @returns {Promise<AudioBuffer>} */
export async function renderSoundtrack(film) {
  const ac = new OfflineAudioContext(2, Math.ceil(RATE * DURATION), RATE);
  const master = ac.createDynamicsCompressor();
  master.threshold.value = -14; master.ratio.value = 4; master.attack.value = .003; master.release.value = .2;
  // duck: music/SFX dip under the voice-over, which joins after the compressor so it never pumps.
  const duck = ac.createGain(), out = ac.createGain(); out.gain.value = .9; master.connect(duck).connect(out).connect(ac.destination);
  const verb = ac.createConvolver(); verb.buffer = impulse(ac, 1.8); const send = ac.createGain(); send.gain.value = .22;
  send.connect(verb).connect(master);
  const noise = noiseBuffer(ac);
  const bus = { ac, master, send, noise };
  const sfx = createSfx(ac, { output: master, level: 1.25 });
  // Slow motion on screen → slowed collision voices (lower, longer), from the film's real playback rate.
  const stretchAt = (t) => { const rate = film.rateAt(t); return rate > 0 ? Math.min(2.6, Math.sqrt(1 / Math.min(1, rate))) : 2.6; };

  // Title: two whooshes converge, then the collision.
  sweep(bus, 0, .95, 300, 3200, .12, -.8); sweep(bus, 0, .95, 260, 2800, .12, .8);
  boom(bus, .95, 1.2); sfx.hit({ when: .95, speed: 1850, x: 500, stretch: 1.6, variation: 0 });
  for (const t of titlePuckBounces(2.75)) sfx.wall({ when: t, speed: 1400, x: 500 });
  sweep(bus, 2.65, .75, 400, 6000, .13, 0);

  // Beat bed: 120 BPM through the flat shot, riser across the tilt, half-time in 3D.
  for (let t = 3.4; t < 11; t += .5) kick(bus, t, .55);
  for (let t = 3.65; t < 11; t += .5) hat(bus, t, .035);
  for (let t = 3.4; t < 11; t += 2) bass(bus, t, 2, [55, 55, 65.4, 49][Math.round((t - 3.4) / 2) % 4]);
  sweep(bus, 11, 2.9, 200, 5200, .16, 0); tone(bus, 11, 2.9, 110, 440, 'sawtooth', .045);
  for (let t = 14; t < film.powerShot.video - .2; t += 1) kick(bus, t, .7);
  for (let t = 14.5; t < film.powerShot.video - .2; t += 1) hat(bus, t, .03);
  bass(bus, 14, film.powerShot.video - 14, 41.2);

  // Rally collisions at their on-screen times.
  for (const e of film.events) {
    const voice = { when: e.video, speed: e.speed, x: e.x, side: e.side, stretch: stretchAt(e.video), variation: ((e.index || 0) * .37) % 1 - .5 };
    if (e.type === 'hit') sfx.hit(voice);
    else if (e.type === 'wall') sfx.wall(voice);
    else if (e.type === 'post') sfx.post(voice);
  }
  boom(bus, film.powerShot.video, 1.6);
  tone(bus, film.powerShot.video + .1, film.goal.video - film.powerShot.video, 82, 164, 'sawtooth', .02);
  sweep(bus, film.powerShot.video + .2, film.goal.video - film.powerShot.video - .2, 500, 7000, .12, 0);
  goalHit(bus, film.goal.video);

  // Lift shot: a soft chord; end card: stamp and the game's win arpeggio.
  for (const f of [220, 277.2, 329.6, 415.3]) pad(bus, 20.7, 4.6, f, .055);
  boom(bus, 26.2, .6);
  [440, 554, 659, 880].forEach((f, i) => tone(bus, 27.7 + i * .12, .5, f, f * .98, 'sine', .07));
  for (const f of [220, 277.2, 329.6, 440]) pad(bus, 27.7, 2.2, f, .045);

  await toySegment(bus, sfx, duck, out);
  return ac.startRendering();
}

/** Closing Toy segment: transition whoosh, a light bed at 120 BPM, UI ticks on each beat, then the voice. */
async function toySegment(bus, sfx, duck, out) {
  const { ac } = bus;
  sweep(bus, TOY_START - .45, .7, 500, 5200, .12, 0);
  sfx.wall({ when: TOY_START + .45, speed: 900, x: 700 });
  for (const f of [220, 277.2, 329.6, 415.3]) pad(bus, TOY_START + .2, DURATION - TOY_START - .3, f, .04);
  for (let t = TOY_START + .5; t < DURATION - 1; t += .5) kick(bus, t, .32);
  for (let t = TOY_START + .75; t < DURATION - 1; t += .5) hat(bus, t, .022);
  for (let t = TOY_START + .5; t < DURATION - 1; t += 2) bass(bus, t, 2, [55, 65.4, 49, 55][Math.round((t - TOY_START - .5) / 2) % 4]);
  for (const t of [BEATS.step1, BEATS.step2, BEATS.link]) sfx.wall({ when: t, speed: 700, x: 300 });
  for (let i = 0; i < 3; i += 1) tone(bus, BEATS.typeFrom + i * (BEATS.typeTo - BEATS.typeFrom) / 2, .04, 2400, 2000, 'square', .012);
  sfx.hit({ when: BEATS.play + .05, speed: 1700, x: 800, variation: 0 });
  [440, 554, 659, 880].forEach((f, i) => tone(bus, BEATS.play + .25 + i * .1, .5, f, f * .98, 'sine', .05));

  const res = await fetch(VOICE_URL);
  if (!res.ok) throw new Error(`voice-over ${VOICE_URL.pathname}: HTTP ${res.status}`);
  const voice = await ac.decodeAudioData(await res.arrayBuffer());
  const end = VO_START + voice.duration;
  // BEATS / VO_LINES are timed to this take; a longer re-take must not be silently cut at the film's end.
  if (end > DURATION - .35) throw new Error(`voice-over ends at ${end.toFixed(2)} s, past DURATION - 0.35 s; retime toycard.mjs`);
  duck.gain.setValueAtTime(1, VO_START - .25); duck.gain.linearRampToValueAtTime(.42, VO_START);
  duck.gain.setValueAtTime(.42, end); duck.gain.linearRampToValueAtTime(1, end + .3);
  const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = voice; g.gain.value = .55; // ≈ -5 dB: keeps the Toy section level with the rally (measured with ebur128)
  src.connect(g).connect(out); src.start(VO_START);
}

function noiseBuffer(ac) {
  const b = ac.createBuffer(1, RATE * 2, RATE), d = b.getChannelData(0);
  let seed = 7; for (let i = 0; i < d.length; i += 1) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
  return b;
}

function impulse(ac, seconds) {
  const b = ac.createBuffer(2, RATE * seconds, RATE);
  for (let c = 0; c < 2; c += 1) {
    const d = b.getChannelData(c); let seed = 11 + c;
    for (let i = 0; i < d.length; i += 1) { seed = (seed * 48271) % 2147483647; d[i] = (seed / 1073741823.5 - 1) * Math.pow(1 - i / d.length, 3); }
  }
  return b;
}

function envGain(bus, when, attack, level, duration, pan = 0, wet = true) {
  const { ac, master, send } = bus;
  const g = ac.createGain();
  g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(Math.max(.0002, level), when + attack);
  g.gain.exponentialRampToValueAtTime(.0001, when + duration);
  const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); if (wet) p.connect(send);
  return g;
}

function tone(bus, when, duration, f0, f1, type, level, pan = 0, attack = .006) {
  const o = bus.ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + duration);
  o.connect(envGain(bus, when, attack, level, duration, pan)); o.start(when); o.stop(when + duration + .05);
}

function noise(bus, when, duration, frequency, q, level, pan = 0, type = 'bandpass') {
  const s = bus.ac.createBufferSource(); s.buffer = bus.noise;
  const f = bus.ac.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q;
  s.connect(f).connect(envGain(bus, when, .003, level, duration, pan)); s.start(when, (when * 7.3) % 1); s.stop(when + duration + .02);
}

function sweep(bus, when, duration, f0, f1, level, pan) {
  const s = bus.ac.createBufferSource(); s.buffer = bus.noise; s.loop = true;
  const f = bus.ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
  f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(f1, when + duration);
  const g = envGain(bus, when, duration * .85, level, duration, pan);
  s.connect(f).connect(g); s.start(when); s.stop(when + duration + .05);
}

function kick(bus, when, level) { tone(bus, when, .28, 120, 42, 'sine', level, 0, .003); noise(bus, when, .02, 3000, 1, .04); }
function hat(bus, when, level) { noise(bus, when, .035, 8000, .7, level, .15, 'highpass'); }

function bass(bus, when, duration, f) {
  const o = bus.ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const lp = bus.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
  o.connect(lp).connect(envGain(bus, when, .05, .16, duration, 0, false)); o.start(when); o.stop(when + duration + .05);
}

function boom(bus, when, size) {
  tone(bus, when, .9 * size, 90, 28, 'sine', .55, 0, .002);
  noise(bus, when, .25 * size, 900, .8, .2);
  noise(bus, when, .6 * size, 300, .6, .12, 0, 'lowpass');
}

function goalHit(bus, when) {
  boom(bus, when, 1.3);
  [390, 487.5, 585, 780].forEach((f, i) => tone(bus, when + i * .09, .5, f, f * .92, 'triangle', .12));
  noise(bus, when, 1.4, 6000, .5, .09, 0, 'highpass');
}

function pad(bus, when, duration, f, level) {
  for (const detune of [-6, 6]) {
    const o = bus.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = detune;
    const lp = bus.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp).connect(envGain(bus, when, duration * .4, level, duration)); o.start(when); o.stop(when + duration + .05);
  }
}

/** 16-bit PCM WAV encoder. */
export function toWav(buffer) {
  const channels = buffer.numberOfChannels, length = buffer.length, view = new DataView(new ArrayBuffer(44 + length * channels * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + length * channels * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < length; i += 1) for (let c = 0; c < channels; c += 1) { const v = Math.max(-1, Math.min(1, data[c][i])); view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return view.buffer;
}
