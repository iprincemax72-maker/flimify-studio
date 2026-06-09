// Flimify Studio — local backend ("studio-bridge"). Electron's main process
// spawns this. Standalone-app equivalent of the Premiere extension's bridge,
// minus all Premiere/ExtendScript coupling:
//   • serves imported + generated media to the editor/preview (HTTP range)
//   • /import   — ffprobe a local video → register + return clip metadata
//   • /generate — spawn the local `claude` CLI → Remotion/HyperFrames render →
//                 an alpha overlay clip for the timeline (NO API key — runs on
//                 the user's own Claude subscription, like the extension)
//   • /export   — the timeline state → a Remotion render → final mp4
//
// State lives under ~/FlimifyStudio. The Remotion render project is reused from
// the existing install for now (configurable via FLIMIFY_RENDER_PROJECT).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.FLIMIFY_STUDIO_PORT) || 3939;
const HOME = os.homedir();
const STUDIO_DIR = process.env.FLIMIFY_STUDIO_DIR || path.join(HOME, 'FlimifyStudio');
const MEDIA_DIR = path.join(STUDIO_DIR, 'media');
const RENDER_DIR = path.join(STUDIO_DIR, 'renders');
const WORK_DIR = path.join(STUDIO_DIR, 'work');
const REGISTRY = path.join(STUDIO_DIR, 'registry.json');
const RENDER_PROJECT = process.env.FLIMIFY_RENDER_PROJECT || path.join(HOME, 'PremiereClaude', 'remotion-intro');
const FFMPEG = process.env.FLIMIFY_FFMPEG || 'ffmpeg';
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
const CLAUDE = process.env.FLIMIFY_CLAUDE || path.join(HOME, '.local', 'bin', 'claude');
const FPS = 30;

for (const d of [STUDIO_DIR, MEDIA_DIR, RENDER_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true });

let registry = {};
try { registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch {}
const saveRegistry = () => { try { fs.writeFileSync(REGISTRY, JSON.stringify(registry)); } catch {} };
let _idc = 0;
const newId = () => 'm' + Date.now().toString(36) + (_idc++).toString(36);
const log = (...a) => console.log('[studio-bridge]', ...a);

// ── helpers ─────────────────────────────────────────────────────────────────
function probe(file) {
  return new Promise((resolve) => {
    execFile(FFPROBE, [
      '-v', 'error', '-of', 'json',
      '-show_entries', 'format=duration:stream=width,height,codec_type,r_frame_rate,pix_fmt',
      file,
    ], { timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(out || '{}');
        const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
        const dur = Number(j.format && j.format.duration) || 0;
        const fr = String(v.r_frame_rate || '30/1').split('/');
        const fps = (+fr[0] && +fr[1]) ? (+fr[0] / +fr[1]) : 30;
        resolve({
          width: Number(v.width) || 1920,
          height: Number(v.height) || 1080,
          durationSec: dur,
          fps,
          hasAlpha: /yuva|rgba|argb/i.test(v.pix_fmt || ''),
        });
      } catch { resolve(null); }
    });
  });
}

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function serveMedia(req, res, id) {
  const entry = registry[id];
  if (!entry || !fs.existsSync(entry.path)) { res.writeHead(404); res.end(); return; }
  const stat = fs.statSync(entry.path);
  const total = stat.size;
  const ext = path.extname(entry.path).toLowerCase();
  const type = ext === '.mov' ? 'video/quicktime' : ext === '.webm' ? 'video/webm'
    : ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'video/mp4';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    res.writeHead(206, { ...cors, 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(entry.path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': total });
    fs.createReadStream(entry.path).pipe(res);
  }
}

function register(file, name) {
  const id = newId();
  registry[id] = { path: file, name: name || path.basename(file) };
  saveRegistry();
  return id;
}

const clipFromProbe = (id, name, meta) => ({
  id, kind: 'video', name,
  src: `http://localhost:${PORT}/media/${id}`,
  width: meta.width, height: meta.height, fps: meta.fps,
  durationFrames: Math.max(1, Math.round(meta.durationSec * FPS)),
  hasAlpha: meta.hasAlpha,
});

// ── AI overlay generation (no API key — local Claude CLI) ───────────────────
// Compact system prompt: build a TRANSPARENT motion-graphic overlay and render
// ProRes 4444 .mov to an exact path, then emit [[IMPORT:path]]. Mirrors the
// extension's proven recipe.
function genSystemPrompt(engine, w, h, durSec, outFile) {
  const common = `You are generating ONE transparent motion-graphic OVERLAY for a video editor. It sits on a track ABOVE the footage, so it MUST have a fully transparent background — only the graphic elements are visible. Canvas ${w}x${h}, 30fps, about ${durSec.toFixed(1)} seconds. Animate in quickly, hold readable, exit at the end. Keep text within the centre safe area.`;
  if (engine === 'hyperframes') {
    return `${common}

Build it as a HYPERFRAMES block: one self-contained HTML file animated by ONE paused GSAP timeline registered at window.__timelines["main"], with a #root carrying data-composition-id="main" data-duration="${durSec.toFixed(2)}" data-width="${w}" data-height="${h}". Do NOT paint any background (transparent overlay). Load GSAP from CDN. Everything that moves is on the timeline.

Save the block to a fresh dir's index.html under ${path.dirname(outFile)}/.hfsrc/, then render it to EXACTLY this path:
  cd "${RENDER_PROJECT}" && npx hyperframes render "<that dir>" -o "${outFile}" --format mov --fps 30 --quality high
When done, emit: [[IMPORT:${outFile}]]`;
  }
  return `${common}

Build a FRESH Remotion composition (transparent — no opaque background AbsoluteFill). Read ~/.claude/skills/remotion-best-practices/rules/transparent-videos.md and timing.md first. Work inside ${RENDER_PROJECT}: write src/<Name>.tsx, register it in src/Root.tsx, then render to EXACTLY this path with alpha:
  cd "${RENDER_PROJECT}" && npx remotion render src/index.ts <Name> "${outFile}" --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le --mute --hardware-acceleration=if-possible
ProRes 4444 + yuva444p10le is required so the alpha survives. When done, emit: [[IMPORT:${outFile}]]`;
}

function generate({ prompt, engine, width, height, durationSec }, onStatus) {
  return new Promise((resolve) => {
    const w = width || 1920, h = height || 1080, durSec = durationSec || 4;
    const outFile = path.join(RENDER_DIR, 'gen_' + Date.now().toString(36) + '.mov');
    const sys = genSystemPrompt(engine === 'hyperframes' ? 'hyperframes' : 'remotion', w, h, durSec, outFile);
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions', '--append-system-prompt', sys,
      '--no-session-persistence', prompt];
    let proc;
    try { proc = spawn(CLAUDE, args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, error: 'claude not available: ' + e.message }); }
    let buf = '', last = Date.now();
    proc.stdout.on('data', (c) => {
      last = Date.now();
      buf += c.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'assistant' && onStatus) onStatus('working');
        } catch {}
      }
    });
    proc.stderr.on('data', () => { last = Date.now(); });
    const HARD = 12 * 60 * 1000, IDLE = 5 * 60 * 1000;
    const startedAt = Date.now();
    const wd = setInterval(() => {
      if (Date.now() - last > IDLE || Date.now() - startedAt > HARD) { try { proc.kill('SIGKILL'); } catch {} }
    }, 10000);
    proc.on('close', () => {
      clearInterval(wd);
      const ok = fs.existsSync(outFile) && (() => { try { return fs.statSync(outFile).size > 1000; } catch { return false; } })();
      if (!ok) return resolve({ ok: false, error: 'no output rendered' });
      probe(outFile).then((meta) => {
        if (!meta) return resolve({ ok: false, error: 'render unreadable' });
        const id = register(outFile, 'AI · ' + String(prompt).slice(0, 40));
        log('generated', path.basename(outFile), `${meta.width}x${meta.height}`);
        resolve({ ok: true, clip: clipFromProbe(id, 'AI · ' + String(prompt).slice(0, 28), meta) });
      });
    });
    proc.on('error', (e) => { clearInterval(wd); resolve({ ok: false, error: e.message }); });
  });
}

// ── export: timeline state → Remotion render → mp4 ──────────────────────────
function exportTimeline(state, name) {
  return new Promise((resolve) => {
    const out = path.join(RENDER_DIR, (name || 'export_' + Date.now().toString(36)).replace(/[^\w.-]/g, '_') + '.mp4');
    const propsFile = path.join(WORK_DIR, 'export_props_' + Date.now().toString(36) + '.json');
    fs.writeFileSync(propsFile, JSON.stringify({ state }));
    // Renders the bundled studio export composition (see render/ project files
    // installed into the render project's src/_studio).
    const entry = 'src/_studio/index.ts';
    const args = ['remotion', 'render', entry, 'StudioTimeline', out,
      '--props=' + propsFile, '--codec=h264', '--mute', '--hardware-acceleration=if-possible', '--log=error'];
    let proc;
    try { proc = spawn('npx', args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    let err = '';
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(propsFile); } catch {}
      if (code === 0 && fs.existsSync(out)) { log('exported', out); resolve({ ok: true, path: out }); }
      else resolve({ ok: false, error: 'render failed: ' + err.slice(-400) });
    });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = req.url || '/';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET' && u === '/health') return sendJson(res, 200, { ok: true, name: 'flimify-studio-bridge', renderProject: RENDER_PROJECT });
  if (req.method === 'GET' && u.startsWith('/media/')) return serveMedia(req, res, u.slice('/media/'.length));
  if (req.method === 'POST' && u === '/import') {
    const { path: src } = await readBody(req);
    if (!src || !fs.existsSync(src)) return sendJson(res, 400, { error: 'file not found' });
    const meta = await probe(src);
    if (!meta) return sendJson(res, 422, { error: 'could not read media' });
    const id = register(src, path.basename(src));
    log('import', path.basename(src), `${meta.width}x${meta.height} ${meta.durationSec.toFixed(1)}s`);
    return sendJson(res, 200, { ok: true, clip: clipFromProbe(id, path.basename(src), meta) });
  }
  if (req.method === 'POST' && u === '/generate') {
    const body = await readBody(req);
    if (!body.prompt) return sendJson(res, 400, { error: 'empty prompt' });
    const r = await generate(body);
    return sendJson(res, r.ok ? 200 : 500, r);
  }
  if (req.method === 'POST' && u === '/export') {
    const body = await readBody(req);
    if (!body.state) return sendJson(res, 400, { error: 'no timeline' });
    const r = await exportTimeline(body.state, body.name);
    return sendJson(res, r.ok ? 200 : 500, r);
  }
  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => log(`listening on http://localhost:${PORT}  (render project: ${RENDER_PROJECT})`));
process.on('uncaughtException', (e) => log('uncaught', e && e.message));
