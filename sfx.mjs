// Shared collision sound design for the game and the promo film.
// Pure Web Audio; works with a live AudioContext or an OfflineAudioContext.
//
// Each collision is layered like a real hit:
//   transient click → resonant body (inharmonic modes) → low thump,
// and heavy hits add a saturated snap + sub drop. Speed drives level, pitch and
// length; x position drives stereo pan; `stretch` > 1 renders a slow-motion
// version (lower and longer) for the film.

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const MAX_SPEED = 1850;

function makeNoise(ac) {
  const buffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < data.length; i += 1) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
  return buffer;
}

function makeRoom(ac, seconds = 0.7) {
  const buffer = ac.createBuffer(2, Math.round(ac.sampleRate * seconds), ac.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    let seed = 97 + c * 31;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 48271) % 2147483647;
      const k = i / data.length;
      data[i] = (seed / 1073741823.5 - 1) * Math.pow(1 - k, 4) * (i < ac.sampleRate * .004 ? .3 : 1);
    }
  }
  return buffer;
}

function makeDrive(ac, amount = 2.6) {
  const shaper = ac.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) { const x = i / 511.5 - 1; curve[i] = Math.tanh(amount * x) / Math.tanh(amount); }
  shaper.curve = curve; shaper.oversample = '2x';
  return shaper;
}

/**
 * @param {BaseAudioContext} ac
 * @param {{output?: AudioNode, level?: number, room?: number}} [options]
 */
export function createSfx(ac, { output = ac.destination, level = 1, room = .16 } = {}) {
  const noise = makeNoise(ac);
  const input = ac.createGain(); input.gain.value = level;
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -10; glue.knee.value = 6; glue.ratio.value = 3; glue.attack.value = .002; glue.release.value = .12;
  input.connect(glue).connect(output);
  const verb = ac.createConvolver(); verb.buffer = makeRoom(ac);
  const send = ac.createGain(); send.gain.value = room;
  send.connect(verb).connect(glue);
  const drive = makeDrive(ac); const driveGain = ac.createGain(); driveGain.gain.value = .8;
  drive.connect(driveGain).connect(input); driveGain.connect(send);
  let counter = 0;

  function voiceOut(when, pan, dest) {
    const panner = ac.createStereoPanner(); panner.pan.value = pan;
    panner.connect(dest);
    if (dest === input) panner.connect(send);
    return panner;
  }

  function env(when, attack, peak, decay, out) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(Math.max(.0002, peak), when + attack);
    g.gain.exponentialRampToValueAtTime(.0001, when + attack + Math.max(.004, decay));
    g.connect(out);
    return g;
  }

  function mode(when, freq, peak, decay, out) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, when);
    o.frequency.exponentialRampToValueAtTime(freq * .985, when + decay);
    o.connect(env(when, .0012, peak, decay, out)); o.start(when); o.stop(when + decay + .03);
  }

  function burst(when, { type = 'bandpass', freq, to, q = 1, peak, dur, out }) {
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, when);
    if (to) f.frequency.exponentialRampToValueAtTime(to, when + dur);
    s.connect(f).connect(env(when, .0008, peak, dur, out));
    s.start(when, (counter * .137) % .8); s.stop(when + dur + .03);
  }

  function thump(when, f0, f1, dur, peak, out) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur);
    o.connect(env(when, .002, peak, dur, out)); o.start(when); o.stop(when + dur + .03);
  }

  function common(o) {
    counter += 1;
    const when = Math.max(o.when ?? ac.currentTime, ac.currentTime);
    const i = clamp((o.speed ?? 900) / MAX_SPEED, 0, 1);
    const st = clamp(o.stretch ?? 1, 1, 3);
    const pitch = Math.pow(st, -.3), time = Math.pow(st, .6);
    const vary = 1 + (o.variation ?? Math.sin(counter * 12.9898) * .5) * .05;
    const pan = clamp(((o.x ?? 500) / 1000 - .5) * 1.3, -.7, .7);
    return { when, i, pitch, time, vary, pan };
  }

  /** Mallet ↔ puck: hard plastic clack with weight; heavy hits snap and drop. */
  function hit(o = {}) {
    const { when, i, pitch, time, vary, pan } = common(o);
    const clackPitch = pitch * (o.pitch ?? 1);
    const out = voiceOut(when, pan, input);
    const side = o.side === 'computer' ? .93 : 1.06;
    const f0 = (900 + 420 * i) * side * vary * clackPitch;
    burst(when, { type: 'highpass', freq: 3400 * clackPitch, q: .7, peak: .2 + .32 * i, dur: .007 * time, out });
    [[1, 1, .085], [1.51, .62, .06], [2.29, .4, .042], [3.07, .22, .03]].forEach(([ratio, amp, decay]) =>
      mode(when, f0 * ratio, (.07 + .13 * i) * amp, decay * (1 + .7 * i) * time, out));
    burst(when, { freq: f0 * 1.6, q: 5, peak: .08 + .12 * i, dur: .035 * time, out });
    const heavy = clamp((i - .62) / .38, 0, 1);
    const body = heavy > 0 ? voiceOut(when, pan * .6, drive) : out;
    thump(when, (150 + 120 * i) * pitch, 50 * pitch, (.075 + .1 * i) * time, .2 + .42 * i, body);
    if (heavy > 0) {
      burst(when, { freq: 7600 * clackPitch, to: 1500 * clackPitch, q: 1.1, peak: .3 * heavy, dur: .08 * time, out: body });
      thump(when + .004, 82 * pitch, 34 * pitch, .34 * time, .5 * heavy, body);
      mode(when + .003, 3900 * clackPitch, .045 * heavy, .07 * time, out);
    }
  }

  /** Puck ↔ rail: shorter, woodier knock. */
  function wall(o = {}) {
    const { when, i, pitch, time, vary, pan } = common(o);
    const out = voiceOut(when, pan, input);
    const f0 = (420 + 180 * i) * vary * pitch;
    burst(when, { type: 'lowpass', freq: 5200 * pitch, q: .6, peak: .1 + .2 * i, dur: .005 * time, out });
    [[1, 1, .062], [1.62, .45, .04], [2.71, .22, .026]].forEach(([ratio, amp, decay]) =>
      mode(when, f0 * ratio, (.06 + .13 * i) * amp, decay * time, out));
    burst(when, { freq: f0 * 2.2, q: 3, peak: .05 + .07 * i, dur: .022 * time, out });
    thump(when, 135 * pitch, 62 * pitch, .055 * time, .1 + .22 * i, out);
  }

  /** Puck ↔ goal post: metallic ring. */
  function post(o = {}) {
    const { when, i, pitch, time, vary, pan } = common(o);
    const out = voiceOut(when, pan, input);
    const f0 = 1480 * vary * pitch;
    burst(when, { type: 'highpass', freq: 4200 * pitch, q: .7, peak: .16 + .2 * i, dur: .006 * time, out });
    [[1, 1, .45], [2.76, .5, .28], [5.4, .32, .17], [8.93, .15, .1]].forEach(([ratio, amp, decay]) =>
      mode(when, f0 * ratio, (.08 + .1 * i) * amp, decay * time, out));
    thump(when, 160 * pitch, 70 * pitch, .06 * time, .14 + .18 * i, out);
  }

  return { hit, wall, post, input };
}
