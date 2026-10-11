// Deterministic offline renderer: steps the Three.js scene frame by frame in headless Chromium,
// pipes the frames to ffmpeg and muxes a soft ambient audio bed (YouTube Live needs an audio track).
//
//   node scripts/render.mjs --width=1920 --height=1080 --fps=30 --duration=90 --out=out/saturn.mp4 \
//        --label=LIVE --require-real-textures
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((x) => {
  const [k, ...v] = x.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true];
}));
const W = +args.width || 1280, H = +args.height || 720, FPS = +args.fps || 30, DUR = +args.duration || 90;
const FRAMES = +args.frames || FPS * DUR;               // --frames=N renders only the first N frames (testing)
const OUT = args.out || 'out/saturn.mp4';
const LABEL = args.label === true ? 'LIVE' : (args.label || '');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const TMP = OUT.replace(/\.mp4$/, '') + '.video.mp4';

const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page error]', e.message));

const url = `http://127.0.0.1:${port}/web/index.html?capture=1&duration=${DUR}&label=${encodeURIComponent(LABEL)}`;
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const tex = await page.evaluate(() => window.__textures);
console.log('textures:', JSON.stringify(tex));
if (args['require-real-textures'] && !(tex.saturn && tex.ring && tex.stars)) {
  console.error('ERROR: real textures are missing and --require-real-textures was set. Run scripts/download-textures.sh first.');
  await browser.close(); server.close(); process.exit(2);
}

const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', args.preset || 'slow', '-crf', String(args.crf || 17), '-pix_fmt', 'yuv420p',
  '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0',
  '-movflags', '+faststart', TMP], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = once(ff, 'close');

const t0 = Date.now();
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate((t) => window.__setTime(t), i / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  if (i % 50 === 0 || i === FRAMES - 1) {
    const el = (Date.now() - t0) / 1000, eta = (el / (i + 1)) * (FRAMES - i - 1);
    console.log(`frame ${i + 1}/${FRAMES}  ${(el / (i + 1)).toFixed(2)} s/frame  ETA ${(eta / 60).toFixed(1)} min`);
  }
}
ff.stdin.end();
const [code] = await ffDone;
await browser.close(); server.close();
if (code !== 0) { console.error('ffmpeg failed'); process.exit(1); }

// ---- ambient audio bed (soft drone), exactly as long as the video so the loop stays clean ----
const D = (FRAMES / FPS).toFixed(3);
const mux = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', TMP,
  '-f', 'lavfi', '-i', `sine=frequency=55:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `sine=frequency=82.41:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `sine=frequency=164.81:sample_rate=48000:duration=${D}`,
  '-filter_complex',
  `[1:a]volume=0.55[a1];[2:a]volume=0.30[a2];[3:a]volume=0.12[a3];` +
  `[a1][a2][a3]amix=inputs=3:normalize=0,lowpass=f=500,tremolo=f=0.2:d=0.35,` +
  `afade=t=in:d=2,afade=t=out:st=${Math.max(0, D - 2)}:d=2,volume=0.5[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
  '-movflags', '+faststart', '-shortest', OUT], { stdio: 'inherit' });
if (mux.status !== 0) { console.error('audio mux failed'); process.exit(1); }
fs.rmSync(TMP, { force: true });
console.log(`done -> ${OUT}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${D}s)`);
