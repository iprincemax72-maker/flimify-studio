// Client for the local studio-bridge (the app's backend). In the desktop app
// this is bundled + spawned by Electron; in browser dev it's `node
// studio-bridge/server.cjs`. Window.flimify (preload) exposes desktop-only
// niceties like a native file-open dialog.
import type { Clip, EditorState } from './editor/types';

export const BRIDGE = 'http://localhost:3939';

export type BridgeClip = {
  id: string;
  kind: 'video';
  name: string;
  src: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  hasAlpha: boolean;
  hasAudio?: boolean;
};

declare global {
  interface Window {
    flimify?: {
      isDesktop: boolean;
      versions?: Record<string, string>;
      openVideo?: () => Promise<string | null>;
      saveExport?: (srcPath: string, suggestedName: string) => Promise<string | null>;
      revealFile?: (p: string) => void;
      onMenu?: (cb: (action: string) => void) => void;
      getPathForFile?: (file: File) => string | null;
      restartEngine?: () => Promise<boolean>;
      onEngineRestarted?: (cb: () => void) => void;
      onUpdated?: (cb: () => void) => void;
    };
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BRIDGE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'bridge ' + r.status);
  return j as T;
}

export async function health(): Promise<boolean> {
  try {
    const r = await fetch(BRIDGE + '/health');
    return r.ok;
  } catch {
    return false;
  }
}

export async function importPath(path: string): Promise<BridgeClip> {
  const { clip } = await post<{ clip: BridgeClip }>('/import', { path });
  return clip;
}

/** Web-mode import: upload a File (browser can't hand the bridge a path). */
export async function uploadVideo(file: File): Promise<BridgeClip> {
  const r = await fetch(BRIDGE + '/upload', {
    method: 'POST',
    body: file,
    headers: { 'X-Filename': file.name },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'upload ' + r.status);
  return (j as { clip: BridgeClip }).clip;
}

/** True when running inside the Electron desktop shell (vs a plain browser). */
export const isDesktop = () => !!(window.flimify && window.flimify.isDesktop);

// ── account / auth (real Google sign-in via Supabase) ──
export type PlanFeatures = { autoedit: boolean; captions: boolean; engine: boolean; maxVersions: number };
export type AuthStatus = {
  enabled: boolean; signedIn: boolean; owner: boolean; unlimited: boolean;
  plan: string; name: string; email: string; avatar: string;
  renders_used: number; renders_limit: number; site: string; dashboard: string;
  features: PlanFeatures;
};
/** Free-tier feature set — used as a safe default before the bridge responds. */
export const FREE_FEATURES: PlanFeatures = { autoedit: false, captions: false, engine: false, maxVersions: 1 };
export async function authStatus(): Promise<AuthStatus> {
  const r = await fetch(BRIDGE + '/auth/status', { cache: 'no-store' });
  return r.json();
}
export async function authSignOut(): Promise<AuthStatus> {
  await fetch(BRIDGE + '/auth/signout', { method: 'POST' });
  return authStatus();
}
/** Clear an explicit sign-out + pick up a shared (extension) session if present. */
export async function authReconnect(): Promise<AuthStatus> {
  const r = await fetch(BRIDGE + '/auth/reconnect', { method: 'POST' });
  return r.json();
}
/** Begin Google sign-in — returns the redirect URL (the extension's allow-listed
 *  /connect when its bridge is up). Sign-in is confirmed by polling authStatus
 *  until the freshly-picked account appears (never reports a stale session). */
export async function authBeginSignin(): Promise<{ url: string; viaExt: boolean; pending: boolean }> {
  const r = await fetch(BRIDGE + '/auth/begin-signin', { method: 'POST' });
  return r.json();
}

export async function generate(
  prompt: string,
  engine: 'remotion' | 'hyperframes',
  width: number,
  height: number,
  durationSec: number,
  mode: 'fast' | 'default' | 'slow' = 'default',
  reqId?: string,
  signal?: AbortSignal,
): Promise<BridgeClip> {
  const r = await fetch(BRIDGE + '/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, engine, width, height, durationSec, mode, reqId }),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'bridge ' + r.status);
  return (j as { clip: BridgeClip }).clip;
}

/** Interrupt a running generation — kills the bridge's claude process. */
export async function cancelGeneration(reqId: string): Promise<void> {
  try { await fetch(BRIDGE + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reqId }) }); } catch { /* ignore */ }
}

/** Subscribe to live generation progress for a reqId. Returns an unsubscribe fn. */
export function onProgress(reqId: string, cb: (text: string) => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${BRIDGE}/progress-stream?reqId=${encodeURIComponent(reqId)}`);
    es.addEventListener('progress', (e) => {
      try { const d = JSON.parse((e as MessageEvent).data); if (d.text) cb(d.text); } catch { /* ignore */ }
    });
    es.addEventListener('done', () => { es?.close(); });
  } catch { /* SSE unavailable — estimate bar still works */ }
  return () => { try { es?.close(); } catch { /* ignore */ } };
}

export const newReqId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function exportTimeline(state: EditorState, name: string): Promise<string> {
  const { path } = await post<{ path: string }>('/export', { state, name });
  return path;
}

export async function expandPrompt(prompt: string, level: 'light' | 'medium' | 'heavy'): Promise<string> {
  const { prompt: out } = await post<{ prompt: string }>('/expand', { prompt, level });
  return out;
}

export type PlanQuestion = { id: string; q: string; options: { value: string; label: string }[] };
export async function planQuestions(message: string): Promise<PlanQuestion[]> {
  const { questions } = await post<{ questions: PlanQuestion[] }>('/plan/questions', { message });
  return questions || [];
}

export type CaptionOptions = {
  highlight?: string;
  fontScale?: number;
  position?: 'top' | 'middle' | 'bottom';
  uppercase?: boolean;
  stroke?: number;
  shadow?: number;
};
export async function caption(
  clipId: string,
  style = 'fadeup',
  wordsPerLine = 4,
  options: CaptionOptions = {},
): Promise<BridgeClip> {
  const { clip } = await post<{ clip: BridgeClip }>('/caption', { clipId, style, wordsPerLine, options });
  return clip;
}

export async function deleteMedia(id: string): Promise<void> {
  await post('/delete', { id });
}

// ── Auto-Edit ──
export type AeAnalysis = {
  reqId: string;
  sentences: { start: number; end: number; text: string }[];
  durationSec: number;
  width: number;
  height: number;
  questions: PlanQuestion[];
};
export type AeApplied = { clip: BridgeClip; atSec: number; durationSec: number; label: string; type: string };

export async function autoeditAnalyze(clipId: string): Promise<AeAnalysis> {
  return post<AeAnalysis>('/autoedit/analyze', { clipId });
}
export async function autoeditRun(opts: {
  reqId: string; density: string; tone: string; answers: Record<string, string>; engine: string;
}): Promise<{ applied: AeApplied[]; planned: number }> {
  return post<{ applied: AeApplied[]; planned: number }>('/autoedit/run', opts);
}

export const thumbUrl = (id: string) => `${BRIDGE}/thumb/${id}`;

/** Normalize a bridge clip → an editor timeline clip placed at `from`. */
export function toTimelineClip(b: BridgeClip, from: number): Clip {
  return {
    id: b.id,
    kind: 'video',
    name: b.name,
    src: b.src,
    from,
    durationInFrames: b.durationFrames,
  };
}
