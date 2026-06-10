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
// Web mode: the bridge can also host the built editor (dist/) so the app runs
// in a plain browser at http://localhost:3939/app — same local Claude, no key.
const DIST_DIR = process.env.FLIMIFY_DIST_DIR || path.join(__dirname, '..', 'dist');
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

// ── live progress (SSE) ──────────────────────────────────────────────────────
// generate() emits stage labels (parsed from Claude's tool calls) to whoever is
// subscribed on a reqId, so the panel shows "Writing Logo.tsx" / "Rendering
// video" instead of a blind estimate.
const progressSubs = {}; // reqId → Set<res>
function pushProgress(reqId, text, pct) {
  if (!reqId) return;
  const subs = progressSubs[reqId];
  if (!subs || !subs.size) return;
  const data = JSON.stringify({ reqId, text, pct });
  for (const r of subs) { try { r.write(`event: progress\ndata: ${data}\n\n`); } catch {} }
}
function closeProgress(reqId) {
  const subs = progressSubs[reqId];
  if (!subs) return;
  for (const r of subs) { try { r.write('event: done\ndata: {}\n\n'); r.end(); } catch {} }
  delete progressSubs[reqId];
}
// Map a Claude tool call → a human stage label (or null to ignore).
function toolLabel(name, input) {
  input = input || {};
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    const f = input.file_path || input.path || '';
    if (/\.tsx?$/.test(f)) return 'Writing ' + path.basename(f);
    if (/\.html?$/.test(f)) return 'Writing the block';
    return null;
  }
  if (name === 'Bash') {
    const c = String(input.command || '');
    if (/remotion\s+render|hyperframes\s+render/.test(c)) return 'Rendering video';
    if (/npm\s+(i|install|ci)|pnpm\s+i|yarn/.test(c)) return 'Installing dependencies';
    if (/npx\s+remotion\s+(studio|preview)/.test(c)) return 'Setting up';
    return null;
  }
  if (name === 'Read' && /\.tsx?$|skills/.test(input.file_path || '')) return 'Reading the toolkit';
  return null;
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

// Serve a static file from dist/ (web mode). SPA-friendly: unknown /app paths
// fall back to index.html.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
function serveStatic(res, rel) {
  let file = path.join(DIST_DIR, rel);
  // prevent path traversal
  if (!path.resolve(file).startsWith(path.resolve(DIST_DIR))) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<h2>Flimify Studio — web</h2><p>No build found. Run <code>npm run build</code> first, then reload.</p>');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
}

// Browser upload (web mode): raw file body + X-Filename header → saved + probed.
function handleUpload(req, res) {
  const name = String(req.headers['x-filename'] || 'upload.mp4').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  const dest = path.join(MEDIA_DIR, Date.now().toString(36) + '_' + name);
  const ws = fs.createWriteStream(dest);
  req.pipe(ws);
  ws.on('finish', async () => {
    const meta = await probe(dest);
    if (!meta) { try { fs.unlinkSync(dest); } catch {} return sendJson(res, 422, { error: 'could not read media' }); }
    const id = register(dest, name);
    log('upload', name, `${meta.width}x${meta.height}`);
    sendJson(res, 200, { ok: true, clip: clipFromProbe(id, name, meta) });
  });
  ws.on('error', (e) => { try { fs.unlinkSync(dest); } catch {} sendJson(res, 500, { error: 'upload failed: ' + e.message }); });
  req.on('error', () => { try { ws.destroy(); fs.unlinkSync(dest); } catch {} });
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

// A small JPEG thumbnail for History cards (cached on disk). Grabs a frame ~25%
// in, on a dark backdrop so transparent overlays read.
function makeThumb(id) {
  return new Promise((resolve) => {
    const entry = registry[id];
    if (!entry || !fs.existsSync(entry.path)) return resolve(null);
    const out = path.join(WORK_DIR, 'thumb_' + id + '.jpg');
    if (fs.existsSync(out)) return resolve(out);
    const args = ['-y', '-ss', '0.3', '-i', entry.path,
      '-frames:v', '1', '-vf', 'scale=320:-2', out];
    const ff = spawn(FFMPEG, args, { stdio: 'ignore' });
    const k = setTimeout(() => { try { ff.kill('SIGKILL'); } catch {} resolve(null); }, 15000);
    ff.on('error', () => { clearTimeout(k); resolve(null); });
    ff.on('close', (c) => { clearTimeout(k); resolve(c === 0 && fs.existsSync(out) ? out : null); });
  });
}

function deleteMedia(id) {
  const entry = registry[id];
  if (!entry) return { ok: true, alreadyGone: true };
  try { if (fs.existsSync(entry.path) && entry.path.startsWith(RENDER_DIR)) fs.unlinkSync(entry.path); } catch {}
  try { fs.unlinkSync(path.join(WORK_DIR, 'thumb_' + id + '.jpg')); } catch {}
  delete registry[id];
  saveRegistry();
  return { ok: true };
}

// ── AI overlay generation (no API key — local Claude CLI) ───────────────────
// Compact system prompt: build a TRANSPARENT motion-graphic overlay and render
// ProRes 4444 .mov to an exact path, then emit [[IMPORT:path]]. Mirrors the
// extension's proven recipe.
function modeLine(mode) {
  if (mode === 'fast') return ' Keep it to ONE clean, simple move — quick and tasteful, no over-design.';
  if (mode === 'slow') return ' Make it a layered, choreographed, polished piece — multiple coordinated elements, refined easing, premium detailing.';
  return ' A real, custom-built graphic — considered composition, motion and type.';
}
function genSystemPrompt(engine, w, h, durSec, outFile, mode) {
  const common = `You are generating ONE transparent motion-graphic OVERLAY for a video editor. It sits on a track ABOVE the footage, so it MUST have a fully transparent background — only the graphic elements are visible. Canvas ${w}x${h}, 30fps, about ${durSec.toFixed(1)} seconds. Animate in quickly, hold readable, exit at the end. Keep text within the centre safe area.` + modeLine(mode);
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

// Running generation processes, keyed by reqId, so /cancel can interrupt them.
const genProcs = {};
function cancelGen(reqId) {
  const p = reqId && genProcs[reqId];
  if (p) { try { p.kill('SIGKILL'); } catch {} delete genProcs[reqId]; closeProgress(reqId); return true; }
  return false;
}

function generate({ prompt, engine, width, height, durationSec, mode, reqId }, onStatus) {
  return new Promise((resolve) => {
    const w = width || 1920, h = height || 1080, durSec = durationSec || 4;
    const outFile = path.join(RENDER_DIR, 'gen_' + Date.now().toString(36) + '.mov');
    const emit = (text) => { if (reqId) pushProgress(reqId, text); if (onStatus) onStatus(text); };
    emit('Thinking…');
    const sys = genSystemPrompt(engine === 'hyperframes' ? 'hyperframes' : 'remotion', w, h, durSec, outFile, mode);
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions', '--append-system-prompt', sys,
      '--no-session-persistence', prompt];
    let proc;
    try { proc = spawn(CLAUDE, args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); if (reqId) genProcs[reqId] = proc; }
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
          if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
            for (const blk of ev.message.content) {
              if (blk && blk.type === 'tool_use') { const lab = toolLabel(blk.name, blk.input); if (lab) emit(lab); }
            }
          }
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
      if (reqId) delete genProcs[reqId];
      const ok = fs.existsSync(outFile) && (() => { try { return fs.statSync(outFile).size > 1000; } catch { return false; } })();
      if (!ok) {
        try { fs.writeFileSync(path.join(WORK_DIR, '_gen_debug.log'), dbg); } catch {}
        log('generate produced no output. tail:', dbg.slice(-700));
        closeProgress(reqId);
        return resolve({ ok: false, error: 'no output rendered' });
      }
      probe(outFile).then((meta) => {
        closeProgress(reqId);
        if (!meta) return resolve({ ok: false, error: 'render unreadable' });
        const id = register(outFile, 'AI · ' + String(prompt).slice(0, 40));
        log('generated', path.basename(outFile), `${meta.width}x${meta.height}`);
        resolve({ ok: true, clip: clipFromProbe(id, 'AI · ' + String(prompt).slice(0, 28), meta) });
      });
    });
    proc.on('error', (e) => { clearInterval(wd); closeProgress(reqId); resolve({ ok: false, error: e.message }); });
  });
}

// ── lightweight Claude text calls (expand prompt, plan questions) ───────────
// Pure text in / text out via the local CLI — no render, no API key. Used by
// the composer's Expand button and the "Ask Questions" plan interview.
function claudeText(prompt, sys, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const args = ['-p', '--no-session-persistence'];
    if (sys) args.push('--append-system-prompt', sys);
    args.push(prompt);
    let proc;
    try { proc = spawn(CLAUDE, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, error: 'claude not available: ' + e.message }); }
    let out = '', er = '';
    proc.stdout.on('data', (c) => (out += c.toString()));
    proc.stderr.on('data', (c) => (er += c.toString().slice(-1200)));
    const k = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeoutMs);
    proc.on('error', (e) => { clearTimeout(k); resolve({ ok: false, error: e.message }); });
    proc.on('close', () => {
      clearTimeout(k);
      const text = (out || '').trim();
      text ? resolve({ ok: true, text }) : resolve({ ok: false, error: er.slice(-200) || 'no output' });
    });
  });
}

const EXPAND_SYS = {
  light: 'Lightly. Add a couple of concrete specifics (one or two details).',
  medium: 'Moderately. Flesh it out with composition, motion and type details.',
  heavy: 'Heavily. Write a rich, fully-specified creative brief — palette, type, layout, motion, timing.',
};
async function expandPrompt(prompt, level) {
  const sys = `You rewrite a short motion-graphic prompt into a fuller, clearer creative brief for a video editor. ${EXPAND_SYS[level] || EXPAND_SYS.light} Keep the user's original intent and subject. Do NOT add a background unless asked (overlays are transparent). Return ONLY the rewritten prompt text — no preamble, no quotes, no markdown.`;
  const r = await claudeText(prompt, sys, 90000);
  if (!r.ok) return r;
  return { ok: true, prompt: r.text.replace(/^["'`]|["'`]$/g, '').trim() };
}

async function planQuestions(message) {
  const sys = `You help plan a motion graphic before it's built. Given the user's request, ask 2-3 quick multiple-choice questions whose answers would meaningfully steer the result (e.g. tone, palette, motion style, emphasis). Return ONLY a JSON array, no prose, of the form:
[{"id":"tone","q":"Overall tone?","options":[{"value":"minimal","label":"Clean & minimal"},{"value":"energetic","label":"Energetic & punchy"}]}]
2-4 options per question. No trailing commentary.`;
  const r = await claudeText(message, sys, 90000);
  if (!r.ok) return { ok: true, questions: [] }; // fail-open → build directly
  let txt = r.text.trim();
  const a = txt.indexOf('['), b = txt.lastIndexOf(']');
  if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
  try {
    const questions = JSON.parse(txt);
    return { ok: true, questions: Array.isArray(questions) ? questions.slice(0, 4) : [] };
  } catch { return { ok: true, questions: [] }; }
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

// sentences → caption pages (N words/page, timing spread evenly across each)
function sentencesToLines(segs, perPage = 5) {
  const n = Math.max(1, Math.min(8, perPage | 0));
  const lines = [];
  for (const s of segs) {
    const words = s.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const per = ((s.end - s.start) * 1000) / words.length;
    const timed = words.map((w, i) => ({ text: w, startMs: Math.round(s.start * 1000 + i * per), endMs: Math.round(s.start * 1000 + (i + 1) * per) }));
    for (let i = 0; i < timed.length; i += n) {
      const pg = timed.slice(i, i + n);
      lines.push({ words: pg, startMs: pg[0].startMs, endMs: pg[pg.length - 1].endMs });
    }
  }
  return lines;
}

function renderCaptions(lines, w, h, fps, style, options = {}) {
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
    fs.writeFileSync(propsFile, JSON.stringify({ lines, style, options: options || {}, fps, width: w, height: h }));
    const args = ['remotion', 'render', entryRel, 'Captions', outFile, '--codec=prores', '--prores-profile=4444', '--image-format=png', '--pixel-format=yuva444p10le', '--mute', '--hardware-acceleration=if-possible', '--props=' + propsFile, '--log=error'];
    const proc = spawn(NPX, args, { cwd: RENDER_PROJECT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let er = ''; proc.stderr.on('data', (c) => (er += c.toString()));
    const clean = () => { try { fs.unlinkSync(entryAbs); } catch {} try { fs.unlinkSync(propsFile); } catch {} };
    proc.on('close', (code) => { clean(); (code === 0 && fs.existsSync(outFile)) ? resolve({ ok: true, file: outFile }) : resolve({ ok: false, error: 'caption render failed: ' + er.slice(-300) }); });
    proc.on('error', (e) => { clean(); resolve({ ok: false, error: e.message }); });
  });
}

async function autoCaption(clipId, style, opts = {}) {
  const entry = registry[clipId];
  if (!entry || !fs.existsSync(entry.path)) return { ok: false, error: 'unknown clip' };
  const meta = await probe(entry.path);
  if (!meta) return { ok: false, error: 'could not read clip' };
  log('captions: extracting audio…');
  const wav = await extractAudio(entry.path);
  log('captions: transcribing…');
  const segs = await transcribe(wav);
  if (!segs.length) return { ok: false, error: 'no speech found in the clip' };
  const lines = sentencesToLines(segs, opts.wordsPerLine || 5);
  log('captions: rendering ' + lines.length + ' pages…');
  const r = await renderCaptions(lines, meta.width, meta.height, FPS, style || 'fadeup', opts.options || {});
  if (!r.ok) return r;
  const cm = await probe(r.file);
  const id = register(r.file, 'Captions');
  log('captions: done');
  return { ok: true, clip: clipFromProbe(id, 'Captions', cm) };
}

// ── Auto-Edit: read the footage speech → plan "moments" → generate motion
// graphics for each → return them positioned at their timeline seconds. The
// standalone equivalent of the extension's Auto-Edit, on the local Claude.
const _aeCache = {}; // reqId → { clipId, sentences, meta }
const _aeId = () => 'ae' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

const AE_PER_MIN = { sparse: 3, moderate: 6, dense: 10, full: 14 };
function aeMomentCount(density, durationSec, sentenceCount) {
  if (density === 'full') return Math.min(sentenceCount, 14);
  const perMin = AE_PER_MIN[density] || 6;
  return Math.max(1, Math.min(10, Math.round((perMin * durationSec) / 60)));
}

async function autoEditAnalyze(clipId) {
  const entry = registry[clipId];
  if (!entry || !fs.existsSync(entry.path)) return { ok: false, error: 'unknown clip' };
  const meta = await probe(entry.path);
  if (!meta) return { ok: false, error: 'could not read clip' };
  log('auto-edit: extracting audio…');
  const wav = await extractAudio(entry.path);
  log('auto-edit: transcribing…');
  const sentences = await transcribe(wav);
  if (!sentences.length) return { ok: false, error: 'no speech found — Auto-Edit needs spoken audio' };
  const reqId = _aeId();
  _aeCache[reqId] = { clipId, sentences, meta };
  // a couple of content-driven questions from the transcript (fail-open)
  let questions = [];
  try {
    const transcript = sentences.map((s) => s.text).join(' ').slice(0, 2000);
    const r = await claudeText(transcript, `Read this video transcript. Return ONLY a JSON array of 2 multiple-choice questions (2-4 options each) whose answers would steer motion-graphic overlays for it (e.g. what to emphasize, visual tone). Form: [{"id":"c1","q":"...","options":[{"value":"x","label":"..."}]}]. No prose.`, 60000);
    if (r.ok) { const a = r.text.indexOf('['), b = r.text.lastIndexOf(']'); if (a >= 0 && b > a) { const q = JSON.parse(r.text.slice(a, b + 1)); if (Array.isArray(q)) questions = q.slice(0, 3); } }
  } catch {}
  return { ok: true, reqId, sentences, durationSec: meta.durationSec, width: meta.width, height: meta.height, questions };
}

async function autoEditPlan(sentences, count, tone, answers, durationSec) {
  const transcript = sentences.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n').slice(0, 4000);
  const ans = answers && Object.keys(answers).length ? '\nUser choices: ' + JSON.stringify(answers) : '';
  const sys = `You are planning motion-graphic OVERLAYS for a talking video. Pick exactly ${count} moments spread across the timeline (0–${durationSec.toFixed(0)}s). For each, write a short prompt for a TRANSPARENT overlay graphic that emphasizes what's said at that moment (a kinetic caption of the key phrase, a stat callout, a lower-third, an arrow, an emoji pop — vary them). Tone: ${tone}.${ans}
Return ONLY a JSON array of ${count} items, each: {"atSec": number, "durationSec": number (2-4), "type": "caption"|"stat"|"lowerthird"|"callout"|"emoji", "label": "short name", "prompt": "what to generate"}. atSec must be inside the clip and increasing. No prose.`;
  const r = await claudeText(transcript, sys, 120000);
  if (!r.ok) return [];
  const a = r.text.indexOf('['), b = r.text.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try {
    const plan = JSON.parse(r.text.slice(a, b + 1));
    return Array.isArray(plan) ? plan.filter((m) => m && typeof m.atSec === 'number' && m.prompt).slice(0, count) : [];
  } catch { return []; }
}

async function autoEditRun({ reqId, density, tone, answers, engine }, onStatus) {
  const cached = _aeCache[reqId];
  if (!cached) return { ok: false, error: 'analysis expired — re-run Auto-Edit' };
  const { sentences, meta } = cached;
  const count = aeMomentCount(density || 'moderate', meta.durationSec, sentences.length);
  if (onStatus) onStatus('Planning the edit…');
  log(`auto-edit: planning ${count} moments…`);
  const plan = await autoEditPlan(sentences, count, tone || 'minimal', answers, meta.durationSec);
  if (!plan.length) return { ok: false, error: 'could not plan the edit' };
  const applied = [];
  for (let i = 0; i < plan.length; i++) {
    const m = plan[i];
    if (onStatus) onStatus(`Rendering graphic ${i + 1} of ${plan.length}…`);
    log(`auto-edit: rendering ${i + 1}/${plan.length} — ${m.label || m.type}`);
    const dur = Math.max(2, Math.min(5, Number(m.durationSec) || 3));
    const g = await generate({ prompt: m.prompt, engine, width: meta.width, height: meta.height, durationSec: dur, mode: 'fast' });
    if (g.ok && g.clip) applied.push({ clip: g.clip, atSec: Math.max(0, Number(m.atSec) || 0), durationSec: dur, label: m.label || m.type || 'graphic', type: m.type || 'caption' });
  }
  delete _aeCache[reqId];
  if (!applied.length) return { ok: false, error: 'no graphics rendered' };
  log(`auto-edit: applied ${applied.length}/${plan.length}`);
  return { ok: true, applied, planned: plan.length };
}

// ── account / auth (REAL Google sign-in via Supabase) ───────────────────────
// Reuses the same Supabase project as the Premiere extension, so the real Google
// account (name + avatar) shows up. If you're already signed into the extension,
// Studio picks up that session automatically — no re-login.
const SITE_URL = process.env.FLIMIFY_SITE_URL || 'https://www.flimify.com';
const DASHBOARD_URL = SITE_URL + '/account.html';   // the Dashboard page (account mgmt)
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://hwsyaqmkwitxprtnrzkj.supabase.co').replace(/\/+$/, '');
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_k7tsIqZia0WXf4eGQwcY2w_jFjAkDEK';
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'iprincemax72@gmail.com,anshdhakad9@gmail.com')
  .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const SESSION_FILE = path.join(STUDIO_DIR, 'session.json');
// also read the Premiere extension's session — sign in there → signed in here too
const SHARED_SESSION_FILES = [path.join(HOME, 'PremiereClaude', 'session.json'), path.join(HOME, '.premiere-claude', 'session.json')];
// Explicit Studio sign-out marker. When present, we do NOT fall back to the
// shared extension session (otherwise sign-out would do nothing). Signing in
// again removes it.
const SIGNED_OUT_MARKER = path.join(STUDIO_DIR, '.signedout');

let _session = null;
function loadSession() {
  if (_session && _session.access_token) return _session;
  // honor an explicit Studio sign-out: don't auto-read any shared session
  try { if (fs.existsSync(SIGNED_OUT_MARKER)) return null; } catch {}
  for (const f of [SESSION_FILE, ...SHARED_SESSION_FILES]) {
    try { if (fs.existsSync(f)) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); if (s && s.access_token) { _session = s; return s; } } } catch {}
  }
  return null;
}
function saveSession(s) {
  _session = s;
  try { fs.unlinkSync(SIGNED_OUT_MARKER); } catch {}   // signing in clears the sign-out marker
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(s), { mode: 0o600 }); } catch {}
}
function clearSession() {
  _session = null;
  try { fs.unlinkSync(SESSION_FILE); } catch {}
  try { fs.writeFileSync(SIGNED_OUT_MARKER, '1'); } catch {}   // sticks across the shared-session fallback
}

let _refreshing = null;
async function freshToken() {
  const s = loadSession();
  if (!s || !s.access_token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (s.expires_at && (s.expires_at - now) > 60) return s.access_token;
  if (!s.refresh_token) return s.access_token;
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!r.ok) { if (r.status === 400 || r.status === 401) { clearSession(); return null; } return (loadSession() || {}).access_token || null; }
      const j = await r.json();
      saveSession({ access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, expires_at: j.expires_at || (now + (j.expires_in || 3600)), user: j.user || s.user });
      return j.access_token;
    } catch { return (loadSession() || {}).access_token || null; }
    finally { _refreshing = null; }
  })();
  return _refreshing;
}
async function authStatus() {
  const s = loadSession();
  const base = { enabled: true, signedIn: false, owner: false, unlimited: true, plan: 'local', name: '', email: '', avatar: '', renders_used: 0, renders_limit: 0, site: SITE_URL, dashboard: DASHBOARD_URL };
  if (!s || !s.access_token) return base;
  const token = await freshToken();
  if (!token) return base;
  const email = (s.user && s.user.email) || '';
  const owner = !!email && OWNER_EMAILS.includes(email.toLowerCase());
  const meta = (s.user && (s.user.user_metadata || {})) || {};
  return {
    enabled: true, signedIn: true, email,
    name: meta.full_name || meta.name || email || 'Account',
    avatar: meta.avatar_url || meta.picture || '',
    owner, unlimited: true,                       // your own Claude → unlimited
    plan: owner ? 'studio' : 'free',
    renders_used: 0, renders_limit: owner ? 999999 : 5,
    site: SITE_URL, dashboard: DASHBOARD_URL,
  };
}

// The sign-in page Studio opens in the browser: Supabase Google OAuth, then it
// hands the session back to this bridge (POST /auth/session).
const CONNECT_HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Flimify Studio</title>'
  + '<style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0d0d10;color:#f2efe6;display:grid;place-items:center;height:100vh}.card{width:min(420px,90vw);background:#15151a;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:28px;text-align:center}.glyph{width:48px;height:48px;border-radius:13px;margin:0 auto 16px;display:grid;place-items:center;background:linear-gradient(135deg,#e89a6c,#d97757);color:#1a1205;font-weight:800;font-size:24px}.big{font-size:20px;font-weight:700;margin:0 0 6px}.sub{color:#9b9588;font-size:13px;line-height:1.5;margin:0 0 18px}.gbtn{display:inline-flex;align-items:center;gap:10px;background:#fff;color:#1a1a1a;border:0;border-radius:11px;padding:11px 18px;font:600 14px system-ui;cursor:pointer}.gbtn svg{width:18px;height:18px}.e{color:#e98c7a;font-size:13px;margin-top:12px}</style></head>'
  + '<body><div class="card"><div class="glyph">F</div><div id="view"><p class="sub">Loading…</p></div></div>'
  + '<script type="module">'
  + 'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";'
  + 'var SB_URL="' + SUPABASE_URL + '",SB_ANON="' + SUPABASE_ANON + '";'
  + 'var supabase=createClient(SB_URL,SB_ANON,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}});'
  + 'var view=document.getElementById("view");function show(h){view.innerHTML=h;}'
  + 'var G=\'<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>\';'
  + 'async function push(s){try{var r=await fetch("/auth/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at,user:s.user})});return r.ok;}catch(e){return false;}}'
  + 'function signin(){show(\'<p class="big">Sign in to Flimify Studio</p><p class="sub">Continue with Google. Runs unlimited on your own Claude.</p><button id="g" class="gbtn">\'+G+\' Continue with Google</button><div id="er" class="e" style="display:none"></div>\');var er=document.getElementById("er");document.getElementById("g").onclick=async function(){var r=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+"/connect",queryParams:{prompt:"select_account"}}});if(r.error){er.textContent=r.error.message;er.style.display="block";}};}'
  + '(async function(){var Q=new URLSearchParams(location.search);if(Q.get("reauth")==="1"&&!Q.get("code")){try{await supabase.auth.signOut({scope:"local"});}catch(e){}signin();return;}var res=await supabase.auth.getSession();var session=res.data.session;if(session){show(\'<p class="big">Connecting…</p>\');var ok=await push(session);show(ok?\'<p class="big">&#10003; Signed in</p><p class="sub">Signed in as <b>\'+(session.user.email||"")+\'</b>. You can close this tab and go back to Flimify Studio.</p>\':\'<p class="big">Almost there</p><p class="sub">Couldn&#39;t reach Studio. Make sure Flimify Studio is open, then reload.</p>\');return;}signin();})();'
  + '<\/script></body></html>';

// ── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = req.url || '/';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET' && u === '/health') return sendJson(res, 200, { ok: true, name: 'flimify-studio-bridge', renderProject: RENDER_PROJECT, web: fs.existsSync(DIST_DIR) });
  // ── web mode: host the built editor ──
  if (req.method === 'GET' && (u === '/' || u === '/app' || u.startsWith('/app/'))) {
    return serveStatic(res, u === '/' || u === '/app' || u === '/app/' ? 'index.html' : u.replace(/^\/app\//, ''));
  }
  if (req.method === 'GET' && /^\/(assets\/|favicon\.|apple-touch-icon|icons\.svg|vite\.svg)/.test(u)) {
    return serveStatic(res, u.replace(/^\//, ''));
  }
  if (req.method === 'POST' && u === '/upload') return handleUpload(req, res);
  if (req.method === 'GET' && u.startsWith('/progress-stream')) {
    const reqId = new URL(u, 'http://x').searchParams.get('reqId');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(':ok\n\n');
    if (reqId) {
      (progressSubs[reqId] = progressSubs[reqId] || new Set()).add(res);
      req.on('close', () => { const s = progressSubs[reqId]; if (s) { s.delete(res); if (!s.size) delete progressSubs[reqId]; } });
    }
    return;
  }
  if (req.method === 'GET' && u.startsWith('/media/')) return serveMedia(req, res, u.slice('/media/'.length));
  if (req.method === 'GET' && u.startsWith('/thumb/')) {
    const t = await makeThumb(u.slice('/thumb/'.length));
    if (!t) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' });
    return fs.createReadStream(t).pipe(res);
  }
  if (req.method === 'POST' && u === '/delete') {
    const { id } = await readBody(req);
    if (!id) return sendJson(res, 400, { error: 'no id' });
    return sendJson(res, 200, deleteMedia(id));
  }
  if (req.method === 'POST' && u === '/import') {
    const { path: src } = await readBody(req);
    if (!src || !fs.existsSync(src)) return sendJson(res, 400, { error: 'file not found' });
    const meta = await probe(src);
    if (!meta) return sendJson(res, 422, { error: 'could not read media' });
    const id = register(src, path.basename(src));
    log('import', path.basename(src), `${meta.width}x${meta.height} ${meta.durationSec.toFixed(1)}s`);
    return sendJson(res, 200, { ok: true, clip: clipFromProbe(id, path.basename(src), meta) });
  }
  if (req.method === 'GET' && u === '/auth/status') { const st = await authStatus(); return sendJson(res, 200, st); }
  if (req.method === 'POST' && u === '/auth/session') {
    const p = await readBody(req);
    if (!p.access_token) return sendJson(res, 400, { error: 'no token' });
    saveSession({ access_token: p.access_token, refresh_token: p.refresh_token || '', expires_at: p.expires_at || 0, user: p.user || null });
    log('signed in: ' + ((p.user && p.user.email) || '?'));
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && u === '/auth/signout') {
    clearSession();
    log('signed out');
    return sendJson(res, 200, { ok: true });
  }
  // Clear the explicit sign-out so a shared (extension) session is picked up again.
  if (req.method === 'POST' && u === '/auth/reconnect') {
    try { fs.unlinkSync(SIGNED_OUT_MARKER); } catch {}
    _session = null;
    const st = await authStatus();
    if (st.signedIn) log('reconnected: ' + st.email);
    return sendJson(res, 200, st);
  }
  if (req.method === 'GET' && (u === '/connect' || u.startsWith('/connect?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(CONNECT_HTML);
  }
  if (req.method === 'POST' && u === '/cancel') {
    const { reqId } = await readBody(req);
    const killed = cancelGen(reqId);
    log('cancel', reqId, killed ? '(killed)' : '(nothing running)');
    return sendJson(res, 200, { ok: true, killed });
  }
  if (req.method === 'POST' && u === '/generate') {
    const body = await readBody(req);
    if (!body.prompt) return sendJson(res, 400, { error: 'empty prompt' });
    const r = await generate(body);
    return sendJson(res, r.ok ? 200 : 500, r);
  }
  if (req.method === 'POST' && u === '/expand') {
    const body = await readBody(req);
    if (!body.prompt) return sendJson(res, 400, { error: 'empty prompt' });
    const r = await expandPrompt(String(body.prompt), body.level);
    return sendJson(res, r.ok ? 200 : 500, r);
  }
  if (req.method === 'POST' && u === '/plan/questions') {
    const body = await readBody(req);
    if (!body.message) return sendJson(res, 400, { error: 'empty message' });
    const r = await planQuestions(String(body.message));
    return sendJson(res, 200, r);
  }
  if (req.method === 'POST' && u === '/export') {
    const body = await readBody(req);
    if (!body.state) return sendJson(res, 400, { error: 'no timeline' });
    const r = await exportTimeline(body.state, body.name);
    return sendJson(res, r.ok ? 200 : 500, r);
  }
  if (req.method === 'POST' && u === '/autoedit/analyze') {
    const body = await readBody(req);
    if (!body.clipId) return sendJson(res, 400, { error: 'no clip' });
    try {
      const r = await autoEditAnalyze(body.clipId);
      return sendJson(res, r.ok ? 200 : 500, r);
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && u === '/autoedit/run') {
    const body = await readBody(req);
    if (!body.reqId) return sendJson(res, 400, { error: 'no reqId' });
    try {
      const r = await autoEditRun(body);
      return sendJson(res, r.ok ? 200 : 500, r);
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }
  if (req.method === 'POST' && u === '/caption') {
    const body = await readBody(req);
    if (!body.clipId) return sendJson(res, 400, { error: 'no clip' });
    try {
      const r = await autoCaption(body.clipId, body.style, { wordsPerLine: body.wordsPerLine, options: body.options });
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
