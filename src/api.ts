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

export async function generate(
  prompt: string,
  engine: 'remotion' | 'hyperframes',
  width: number,
  height: number,
  durationSec: number,
): Promise<BridgeClip> {
  const { clip } = await post<{ clip: BridgeClip }>('/generate', {
    prompt, engine, width, height, durationSec,
  });
  return clip;
}

export async function exportTimeline(state: EditorState, name: string): Promise<string> {
  const { path } = await post<{ path: string }>('/export', { state, name });
  return path;
}

export async function caption(clipId: string, style = 'tiktok'): Promise<BridgeClip> {
  const { clip } = await post<{ clip: BridgeClip }>('/caption', { clipId, style });
  return clip;
}

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
