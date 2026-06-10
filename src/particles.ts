// Accent-tinted particle field behind the UI — ported 1:1 from the extension's
// Particles engine. Renders into #particleCanvas; configure(style, rgb) swaps
// the look live. Delta-timed so motion is frame-rate independent.

type Cfg = { count: number; rMin: number; rMax: number; speed: number; alpha: number; twinkle: number; lines: boolean; drift: 'up' | 'free' };
type Part = { x: number; y: number; r: number; vx: number; vy: number; ph: number; tw: number; a: number };

const STYLE_CFG: Record<string, Cfg> = {
  dust:    { count: 130, rMin: 1.6, rMax: 4.6,  speed: 0.26, alpha: 1.0,  twinkle: 0.2,  lines: false, drift: 'up' },
  bokeh:   { count: 24, rMin: 7.0, rMax: 20.0, speed: 0.14, alpha: 0.28, twinkle: 0.0,  lines: false, drift: 'free' },
  stars:   { count: 90, rMin: 0.6, rMax: 2.0,  speed: 0.09, alpha: 0.9,  twinkle: 1.0,  lines: false, drift: 'free' },
  network: { count: 50, rMin: 1.4, rMax: 2.8,  speed: 0.34, alpha: 0.8,  twinkle: 0.0,  lines: true,  drift: 'free' },
};

let cvs: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let W = 0, H = 0, dpr = 1;
let raf = 0, running = false;
let style = 'dust';
let rgb = '217,119,87';
let sprite: HTMLCanvasElement | null = null, spriteR = 0;
let parts: Part[] = [];
let t = 0, lastTs = 0;

const cfg = () => STYLE_CFG[style] || STYLE_CFG.dust;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function resize() {
  if (!cvs) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = cvs.clientWidth || window.innerWidth;
  H = cvs.clientHeight || window.innerHeight;
  cvs.width = Math.max(1, Math.floor(W * dpr));
  cvs.height = Math.max(1, Math.floor(H * dpr));
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function buildSprite() {
  const c = cfg();
  spriteR = Math.ceil(c.rMax * 2 + 4);
  const s = document.createElement('canvas');
  s.width = s.height = spriteR * 2;
  const g = s.getContext('2d')!;
  const grad = g.createRadialGradient(spriteR, spriteR, 0, spriteR, spriteR, spriteR);
  grad.addColorStop(0, 'rgba(' + rgb + ',1)');
  grad.addColorStop(0.4, 'rgba(' + rgb + ',0.55)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(spriteR, spriteR, spriteR, 0, Math.PI * 2);
  g.fill();
  sprite = s;
}

function spawn() {
  const c = cfg();
  parts = [];
  for (let i = 0; i < c.count; i++) {
    parts.push({
      x: rnd(0, W), y: rnd(0, H),
      r: rnd(c.rMin, c.rMax),
      vx: rnd(-c.speed, c.speed),
      vy: c.drift === 'up' ? -rnd(c.speed * 0.4, c.speed * 1.4) : rnd(-c.speed, c.speed),
      ph: rnd(0, Math.PI * 2),
      tw: rnd(0.6, 1.4),
      a: rnd(c.alpha * 0.5, c.alpha),
    });
  }
}

function frame(ts: number) {
  if (!running || !ctx) return;
  if (!lastTs) lastTs = ts || 0;
  let dt = ts ? (ts - lastTs) / 16.6667 : 1;
  lastTs = ts || lastTs;
  if (!(dt > 0)) dt = 1;
  if (dt > 4) dt = 4;
  t += 0.016 * dt;
  const c = cfg();
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';

  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < -spriteR) p.x = W + spriteR; else if (p.x > W + spriteR) p.x = -spriteR;
    if (p.y < -spriteR) p.y = H + spriteR; else if (p.y > H + spriteR) p.y = -spriteR;
    let alpha = p.a;
    if (c.twinkle) alpha = p.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.tw + p.ph)));
    ctx.globalAlpha = alpha;
    const d = (p.r + 2) * 2;
    if (sprite) ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
  }

  if (c.lines) {
    ctx.globalCompositeOperation = 'source-over';
    const maxD = 120, maxD2 = maxD * maxD;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const dx = parts[i].x - parts[j].x, dy = parts[i].y - parts[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < maxD2) {
          const o = (1 - d2 / maxD2) * 0.18;
          ctx.strokeStyle = 'rgba(' + rgb + ',' + o.toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(parts[i].x, parts[i].y);
          ctx.lineTo(parts[j].x, parts[j].y);
          ctx.stroke();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  raf = requestAnimationFrame(frame);
}

function start() {
  if (running || !ctx) return;
  running = true;
  lastTs = 0;
  raf = requestAnimationFrame(frame);
}
function stop() {
  running = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (ctx) ctx.clearRect(0, 0, W, H);
}

/** Set the particle style + accent rgb. style 'off' clears the field. */
export function configureParticles(newStyle: string, newRgb?: string) {
  if (!cvs) { cvs = document.getElementById('particleCanvas') as HTMLCanvasElement | null; ctx = cvs?.getContext('2d') || null; }
  if (!cvs || !ctx) return;
  style = newStyle || 'dust';
  if (newRgb) rgb = newRgb;
  if (style === 'off') { stop(); return; }
  resize();
  buildSprite();
  spawn();
  start();
}

// pause when backgrounded; re-fit on resize
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (style !== 'off') { resize(); start(); }
  });
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = window.setTimeout(() => { if (style !== 'off' && cvs && ctx) { resize(); buildSprite(); spawn(); } }, 150);
  });
}
