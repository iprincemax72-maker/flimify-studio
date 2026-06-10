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
// ── PATH repair (CRITICAL) ─────────────────────────────────────────────────
// A GUI-launched macOS app inherits a sparse PATH (/usr/bin:/bin:/usr/sbin:
// /sbin) — it does NOT include /opt/homebrew/bin or ~/.local/bin. So a bridge
// spawned by the packaged app can't find ffprobe / npx / node / claude, and
// import + generate + export silently fail. Prepend the real tool dirs so every
// child process (ffmpeg, claude, npx) resolves its binaries.
const _binDirs = [
  '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local', 'bin'),
  '/opt/homebrew/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
];
process.env.PATH = [...new Set([..._binDirs, ...((process.env.PATH || '').split(path.delimiter))])]
  .filter(Boolean).join(path.delimiter);

// Resolve a binary to an absolute path: explicit candidates first, then the
// repaired PATH, then bare name (let spawn try).
function resolveBin(name, candidates) {
  for (const c of candidates || []) { try { if (fs.existsSync(c)) return c; } catch {} }
  for (const d of process.env.PATH.split(path.delimiter)) {
    try { const p = path.join(d, name); if (fs.existsSync(p)) return p; } catch {}
  }
  return name;
}

const FFMPEG = process.env.FLIMIFY_FFMPEG || resolveBin('ffmpeg', ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']);
const FFPROBE = resolveBin('ffprobe', [FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe']);
const CLAUDE = process.env.FLIMIFY_CLAUDE || resolveBin('claude', [path.join(HOME, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
const NPX = resolveBin('npx', [path.join(HOME, '.local', 'bin', 'npx'), '/opt/homebrew/bin/npx', '/usr/local/bin/npx']);
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
    let buf = '', last = Date.now(), dbg = '';
    proc.stdout.on('data', (c) => {
      last = Date.now();
      const s = c.toString();
      dbg = (dbg + s).slice(-6000);
      buf += s;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'assistant' && onStatus) onStatus('working');
          if (ev.type === 'result' && ev.result) dbg = (dbg + '\nRESULT: ' + ev.result).slice(-6000);
        } catch {}
      }
    });
    proc.stderr.on('data', (c) => { last = Date.now(); dbg = (dbg + '\nSTDERR: ' + c.toString()).slice(-6000); });
    const HARD = 12 * 60 * 1000, IDLE = 5 * 60 * 1000;
    const startedAt = Date.now();
    const wd = setInterval(() => {
      if (Date.now() - last > IDLE || Date.now() - startedAt > HARD) { try { proc.kill('SIGKILL'); } catch {} }
    }, 10000);
    proc.on('close', () => {
      clearInterval(wd);
      const ok = fs.existsSync(outFile) && (() => { try { return fs.statSync(outFile).size > 1000; } catch { return false; } })();
      if (!ok) {
        try { fs.writeFileSync(path.join(WORK_DIR, '_gen_debug.log'), dbg); } catch {}
        log('generate produced no output. tail:', dbg.slice(-700));
        return resolve({ ok: false, error: 'no output rendered' });
      }
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
    try { proc = spawn(NPX, args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
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

// ── auto-captions: extract audio → parakeet transcribe → animated overlay ───
const PARAKEET = (() => {
  for (const p of [path.join(HOME, '.local', 'bin', 'parakeet-mlx'), '/opt/homebrew/bin/parakeet-mlx', '/usr/local/bin/parakeet-mlx']) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return 'parakeet-mlx';
})();

function extractAudio(clipPath) {
  return new Promise((resolve, reject) => {
    const out = path.join(WORK_DIR, '_capaudio_' + Date.now().toString(36) + '.wav');
    const ff = spawn(FFMPEG, ['-y', '-i', clipPath, '-ac', '1', '-ar', '16000', out]);
    let er = ''; ff.stderr.on('data', (d) => (er += d.toString().slice(-1500)));
    const k = setTimeout(() => { try { ff.kill('SIGKILL'); } catch {} reject(new Error('audio extract timeout')); }, 90000);
    ff.on('error', (e) => { clearTimeout(k); reject(e); });
    ff.on('close', (c) => { clearTimeout(k); (c === 0 && fs.existsSync(out)) ? resolve(out) : reject(new Error('extract exit ' + c + ': ' + er.slice(-200))); });
  });
}

function transcribe(wav) {
  return new Promise((resolve, reject) => {
    const outDir = path.dirname(wav), base = path.basename(wav, path.extname(wav)), jsonOut = path.join(outDir, base + '.json');
    try { fs.unlinkSync(jsonOut); } catch {}
    const proc = spawn(PARAKEET, ['--output-format', 'json', '--output-dir', outDir, wav], { env: process.env });
    let er = ''; proc.stderr.on('data', (d) => (er += d.toString().slice(-1500))); proc.stdout.on('data', () => {});
    const k = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('parakeet timeout')); }, 15 * 60 * 1000);
    proc.on('error', (e) => { clearTimeout(k); reject(e); });
    proc.on('close', (c) => {
      clearTimeout(k);
      if (c !== 0 || !fs.existsSync(jsonOut)) { reject(new Error('parakeet exit ' + c + ' (is parakeet-mlx installed? `uv tool install parakeet-mlx`): ' + er.slice(-200))); return; }
      try {
        const j = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
        const segs = (j.sentences || []).map((s) => ({ start: +s.start || 0, end: +s.end || 0, text: (s.text || '').trim() })).filter((s) => s.text && s.end > s.start);
        try { fs.unlinkSync(jsonOut); } catch {} try { fs.unlinkSync(wav); } catch {}
        resolve(segs);
      } catch (e) { reject(new Error('parakeet json parse: ' + e.message)); }
    });
  });
}

// sentences → TikTok-style caption pages (~5 words/page, timing spread evenly)
function sentencesToLines(segs) {
  const lines = [];
  for (const s of segs) {
    const words = s.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const per = ((s.end - s.start) * 1000) / words.length;
    const timed = words.map((w, i) => ({ text: w, startMs: Math.round(s.start * 1000 + i * per), endMs: Math.round(s.start * 1000 + (i + 1) * per) }));
    for (let i = 0; i < timed.length; i += 5) {
      const pg = timed.slice(i, i + 5);
      lines.push({ words: pg, startMs: pg[0].startMs, endMs: pg[pg.length - 1].endMs });
    }
  }
  return lines;
}

function renderCaptions(lines, w, h, fps, style) {
  return new Promise((resolve) => {
    const id = Date.now().toString(36);
    const entryRel = path.join('src', '_studcap_' + id + '.tsx');
    const entryAbs = path.join(RENDER_PROJECT, entryRel);
    const propsFile = path.join(WORK_DIR, '_capprops_' + id + '.json');
    const outFile = path.join(RENDER_DIR, 'captions_' + id + '.mov');
    const entry = `import { registerRoot, Composition } from 'remotion';
import { Captions } from './Captions';
const Root = () => (
  <Composition id="Captions" component={Captions}
    defaultProps={{ lines: [], style: '${style}', options: {}, fps: ${fps}, width: ${w}, height: ${h} }}
    calculateMetadata={({ props }) => { const f = props.fps || ${fps}; const ends = (props.lines || []).map((l) => l.endMs); const maxMs = ends.length ? Math.max(...ends) : 1000; return { durationInFrames: Math.max(1, Math.ceil((maxMs / 1000 + 0.3) * f)), width: props.width || ${w}, height: props.height || ${h}, fps: f }; }} />
);
registerRoot(Root);`;
    fs.writeFileSync(entryAbs, entry);
    fs.writeFileSync(propsFile, JSON.stringify({ lines, style, options: {}, fps, width: w, height: h }));
    const args = ['remotion', 'render', entryRel, 'Captions', outFile, '--codec=prores', '--prores-profile=4444', '--image-format=png', '--pixel-format=yuva444p10le', '--mute', '--hardware-acceleration=if-possible', '--props=' + propsFile, '--log=error'];
    const proc = spawn(NPX, args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let er = ''; proc.stderr.on('data', (c) => (er += c.toString()));
    const clean = () => { try { fs.unlinkSync(entryAbs); } catch {} try { fs.unlinkSync(propsFile); } catch {} };
    proc.on('close', (code) => { clean(); (code === 0 && fs.existsSync(outFile)) ? resolve({ ok: true, file: outFile }) : resolve({ ok: false, error: 'caption render failed: ' + er.slice(-300) }); });
    proc.on('error', (e) => { clean(); resolve({ ok: false, error: e.message }); });
  });
}

async function autoCaption(clipId, style) {
  const entry = registry[clipId];
  if (!entry || !fs.existsSync(entry.path)) return { ok: false, error: 'unknown clip' };
  const meta = await probe(entry.path);
  if (!meta) return { ok: false, error: 'could not read clip' };
  log('captions: extracting audio…');
  const wav = await extractAudio(entry.path);
  log('captions: transcribing…');
  const segs = await transcribe(wav);
  if (!segs.length) return { ok: false, error: 'no speech found in the clip' };
  const lines = sentencesToLines(segs);
  log('captions: rendering ' + lines.length + ' pages…');
  const r = await renderCaptions(lines, meta.width, meta.height, FPS, style || 'tiktok');
  if (!r.ok) return r;
  const cm = await probe(r.file);
  const id = register(r.file, 'Captions');
  log('captions: done');
  return { ok: true, clip: clipFromProbe(id, 'Captions', cm) };
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
  if (req.method === 'POST' && u === '/caption') {
    const body = await readBody(req);
    if (!body.clipId) return sendJson(res, 400, { error: 'no clip' });
    try {
      const r = await autoCaption(body.clipId, body.style);
      return sendJson(res, r.ok ? 200 : 500, r);
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('not found');
});

// Port-conflict resilience: if a stale (old-version) bridge holds the port,
// evict it so the newest app's bridge always wins, then retry.
let _listenTries = 0;
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && _listenTries < 8) {
    _listenTries++;
    log('port ' + PORT + ' busy — evicting squatter (try ' + _listenTries + ')');
    try { require('child_process').execSync('lsof -ti tcp:' + PORT + ' | xargs kill -9', { stdio: 'ignore' }); } catch {}
    setTimeout(() => { try { server.listen(PORT, '127.0.0.1'); } catch {} }, 500);
  } else {
    log('listen error', err && err.message);
  }
});
server.listen(PORT, '127.0.0.1', () => log(`listening on http://localhost:${PORT}  (render project: ${RENDER_PROJECT})`));
process.on('uncaughtException', (e) => log('uncaught', e && e.message));
