#!/usr/bin/env node
// Frame-exact recorder for the promo film.
//   node promo/record.mjs stills 0.5 4.3 12 ...   → promo/dist/stills/*.png
//   node promo/record.mjs video [--fps 60]        → promo/dist/air-hockey-collision-promo.mp4
// Needs playwright-core (set PLAYWRIGHT_CORE to its path) and ffmpeg on PATH.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, '..'));
const DIST = join(HERE, 'dist');
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function serve() {
  const server = createServer(async (req, res) => {
    let path;
    try { path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))); }
    catch { res.writeHead(400).end(); return; }
    if (path !== ROOT && !path.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openPage(server) {
  const spec = process.env.PLAYWRIGHT_CORE || 'playwright-core';
  const { chromium } = await import(spec.startsWith('/') ? pathToFileURL(join(spec, 'index.mjs')).href : spec);
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => { console.error('page error:', error.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${server.address().port}/promo/index.html?record=1`);
  await page.waitForFunction(() => window.__promo);
  await page.evaluate(() => window.__promo.ready);
  return { browser, page };
}

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

async function stills(page, times) {
  const dir = join(DIST, 'stills'); await mkdir(dir, { recursive: true });
  for (const t of times) {
    const file = join(dir, `t${t.toFixed(2).padStart(5, '0')}.png`);
    await writeFile(file, decode(await page.evaluate((x) => window.__promo.frame(x), t)));
    console.log(file);
  }
}

async function video(page, fps) {
  await mkdir(DIST, { recursive: true });
  const wav = join(DIST, 'soundtrack.wav'), mp4 = join(DIST, 'air-hockey-collision-promo.mp4');
  await writeFile(wav, Buffer.from(await page.evaluate(() => window.__promo.soundtrackWav()), 'base64'));
  await writeFile(join(DIST, 'events.json'), JSON.stringify(await page.evaluate(() => window.__promo.events), null, 1));
  const duration = await page.evaluate(() => window.__promo.duration);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-i', wav,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.stdin.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  done.catch(() => {}); // observed below; avoid an unhandled rejection while frames are still streaming
  const total = Math.round(duration * fps), started = Date.now();
  for (let i = 0; i < total; i += 1) {
    const frame = decode(await page.evaluate((t) => window.__promo.frame(t), i / fps));
    if (!ff.stdin.write(frame)) await Promise.race([new Promise((resolve) => ff.stdin.once('drain', resolve)), done]);
    if (i % fps === 0) process.stdout.write(`\rframe ${i}/${total}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await done;
  console.log(`\n${mp4}`);
}

/** A/B listening file: the old in-game recipe, then the shared sfx voices at several speeds. */
async function sfxDemo(page) {
  await mkdir(DIST, { recursive: true });
  const { wav, stats } = await page.evaluate(async () => {
    const { createSfx } = await import('../sfx.mjs');
    const { toWav } = await import('./audio.mjs');
    const ac = new OfflineAudioContext(2, 48000 * 9, 48000);
    const sfx = createSfx(ac);
    const noise = ac.createBuffer(1, 48000, 48000); noise.getChannelData(0).forEach((_, i, d) => { d[i] = Math.random() * 2 - 1; });
    const voice = (when, f0, f1, dur, type, level) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur); g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(level, when + .006); g.gain.exponentialRampToValueAtTime(.0001, when + dur); o.connect(g).connect(ac.destination); o.start(when); o.stop(when + dur + .02); };
    const hiss = (when, dur, freq, q, level) => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(level, when + .003); g.gain.exponentialRampToValueAtTime(.0001, when + dur); s.connect(f).connect(g).connect(ac.destination); s.start(when); s.stop(when + dur + .01); };
    const oldHit = (when, heavy) => { voice(when, heavy ? 180 : 145, heavy ? 74 : 92, heavy ? .16 : .105, 'triangle', heavy ? .11 : .08); hiss(when, heavy ? .075 : .045, heavy ? 1350 : 1850, heavy ? 1.4 : 2.5, heavy ? .075 : .052); voice(when + .006, heavy ? 1450 : 1080, heavy ? 2360 : 1420, heavy ? .12 : .055, 'square', heavy ? .025 : .014); };
    const oldWall = (when) => { hiss(when, .033, 2500, 3.8, .026); voice(when, 420, 210, .045, 'triangle', .025); };
    const plan = [
      ['old hit soft', .2, () => oldHit(.2, false)], ['old hit heavy', .7, () => oldHit(.7, true)], ['old wall', 1.2, () => oldWall(1.2)],
      ['new hit 500', 2.2, () => sfx.hit({ when: 2.2, speed: 500, x: 200 })], ['new hit 1100', 2.7, () => sfx.hit({ when: 2.7, speed: 1100, x: 500 })],
      ['new hit 1850', 3.2, () => sfx.hit({ when: 3.2, speed: 1850, x: 800, side: 'computer' })],
      ['new wall 400', 4.0, () => sfx.wall({ when: 4.0, speed: 400, x: 300 })], ['new wall 1500', 4.4, () => sfx.wall({ when: 4.4, speed: 1500, x: 700 })],
      ['new post', 5.0, () => sfx.post({ when: 5.0, speed: 1100, x: 1000 })],
      ['new hit 1850 slow-mo x2.6', 6.2, () => sfx.hit({ when: 6.2, speed: 1850, x: 500, stretch: 2.6 })],
      ['rally', 7.4, () => [[7.4, 'hit', 1500, 150], [7.62, 'wall', 1400, 420], [7.8, 'hit', 1700, 860], [7.98, 'wall', 1500, 650], [8.12, 'post', 1300, 1000]].forEach(([w, k, v, x]) => sfx[k]({ when: w, speed: v, x }))],
    ];
    plan.forEach((p) => p[2]());
    const buffer = await ac.startRendering();
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const stats = plan.map(([name, at], i) => {
      const end = i + 1 < plan.length ? plan[i + 1][1] : 9;
      let peak = 0, sum = 0, n = 0, tail = 0;
      for (let k = Math.floor(at * 48000); k < Math.floor(end * 48000); k += 1) { const v = Math.max(Math.abs(L[k]), Math.abs(R[k])); peak = Math.max(peak, v); sum += (L[k] ** 2 + R[k] ** 2) / 2; n += 1; if (v > .01) tail = k / 48000 - at; }
      return { name, peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1), rmsDb: +(10 * Math.log10(sum / n || 1e-12)).toFixed(1), audibleMs: Math.round(tail * 1000) };
    });
    const bytes = new Uint8Array(toWav(buffer)); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { wav: btoa(bin), stats };
  });
  const file = join(DIST, 'sfx-ab.wav');
  await writeFile(file, Buffer.from(wav, 'base64'));
  console.table(stats); console.log(file);
}

const [mode = 'stills', ...rest] = process.argv.slice(2);
const server = await serve();
const { browser, page } = await openPage(server);
try {
  if (mode === 'sfx') await sfxDemo(page);
  else if (mode === 'video') {
    const fpsIndex = rest.indexOf('--fps');
    await video(page, fpsIndex >= 0 ? Number(rest[fpsIndex + 1]) : await page.evaluate(() => window.__promo.fps));
  } else await stills(page, rest.length ? rest.map(Number) : [0.6, 1.1, 2.0, 3.0, 4.4, 7.8, 10.1, 11.8, 12.8, 14.6, 16.2, 17.8, 18.8, 19.9, 21.0, 22.6, 24.0, 25.2, 27.0, 29.5]);
} finally { await browser.close(); server.close(); }
