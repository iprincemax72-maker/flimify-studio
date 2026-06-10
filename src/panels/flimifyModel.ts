// Conversation model for the Flimify panel — multi-tab chat, ported from the
// extension's in-memory tabs[]. Each tab is its own thread with its own draft,
// render mode, engine, and in-flight state.
import type { BridgeClip, PlanQuestion } from '../api';

export type Engine = 'remotion' | 'hyperframes';
export type RenderMode = 'fast' | 'default' | 'slow';

export type PlanCard = {
  prompt: string;
  loading: boolean;
  questions: PlanQuestion[];
  answers: Record<string, string>;
  note: string;
};

export type Msg =
  | { id: string; role: 'you'; text: string }
  | { id: string; role: 'flimify'; text: string; continuePrompt?: string }
  | { id: string; role: 'render'; clip: BridgeClip; prompt: string; status: string; imported: boolean };

export type IterCtx = { prompt: string; src: string; name: string } | null;

export type FlimifyTab = {
  id: string;
  label: string;
  type: 'animation' | 'chat';
  messages: Msg[];
  draft: string;
  renderMode: RenderMode;
  engine: Engine;
  busy: boolean;
  startedAt: number;     // ms, for the progress estimate
  genStatus: string;     // live stage label from the bridge SSE
  abort: AbortController | null; // interrupt the in-flight generation
  curReqId: string;      // reqId of the in-flight generation (for /cancel)
  cancelled: boolean;    // user interrupted the last run
  iterate: IterCtx;      // "Changes" context for the next send
  outputs: number;       // ×N versions per prompt (1–10)
  queue: { id: string; text: string }[]; // prompts stacked while busy
  paused: boolean;       // queue paused (after a cancel) — ▶ Run resumes
  planMode: boolean;     // "Ask Questions" — interview before building
  plan: PlanCard | null; // active interview card
  refs: string[];        // attached reference image paths
  expanding: boolean;    // Expand button in flight
  chipCat: string;
  chipQuery: string;
};

let _n = 1;
export const mkId = (p = 't') => p + (_n++).toString(36) + Math.random().toString(36).slice(2, 6);

export function newTab(type: 'animation' | 'chat', engine: Engine, renderMode: RenderMode): FlimifyTab {
  return {
    id: mkId(),
    label: type === 'chat' ? 'Chat' : 'New animation',
    type,
    messages: [],
    draft: '',
    renderMode,
    engine,
    busy: false,
    startedAt: 0,
    genStatus: '',
    abort: null,
    curReqId: '',
    cancelled: false,
    iterate: null,
    outputs: 1,
    queue: [],
    paused: false,
    planMode: false,
    plan: null,
    refs: [],
    expanding: false,
    chipCat: 'Popular',
    chipQuery: '',
  };
}

// truncate a first prompt into a tab label (matches the extension's 28-char cap)
export function labelFromPrompt(p: string): string {
  const s = p.trim().replace(/\s+/g, ' ');
  return s.length > 28 ? s.slice(0, 28) + '…' : s || 'New animation';
}
