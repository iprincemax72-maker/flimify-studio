// Render History — every generated graphic, import, and caption track, kept so
// you can re-add it to the timeline or delete it. Mirrors the extension's
// History panel (thumbnails + actions), persisted to localStorage.
import type { BridgeClip } from './api';

export type HistoryKind = 'generate' | 'import' | 'caption';

export type HistoryEntry = {
  id: string;            // bridge media id
  kind: HistoryKind;
  name: string;
  prompt?: string;
  src: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  t: number;             // created-at ms
};

const KEY = 'flimifyStudio.history';
const MAX = 200;

export function loadHistory(): HistoryEntry[] {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

export function saveHistory(h: HistoryEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, MAX))); } catch {}
}

export function entryFromClip(clip: BridgeClip, kind: HistoryKind, prompt?: string): HistoryEntry {
  return {
    id: clip.id,
    kind,
    name: clip.name,
    prompt,
    src: clip.src,
    width: clip.width,
    height: clip.height,
    fps: clip.fps,
    durationFrames: clip.durationFrames,
    t: Date.now(),
  };
}

export function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
