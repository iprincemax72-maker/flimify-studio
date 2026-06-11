// The Flimify AI panel — docked in the editor. Multi-conversation tabs (each its
// own thread, draft, render mode + engine), an empty-state hero with the
// suggestion-chip browser, and in-chat render cards with Import / Preview /
// Changes / Delete — a 1:1 port of the Premiere extension, on the no-API-key
// local-Claude model.
import { useEffect, useRef, useState } from 'react';
import { generate, cancelGeneration, expandPrompt, planQuestions, onProgress, newReqId, type BridgeClip } from '../api';
import { CATEGORIES, chipsFor, ghostFor } from '../suggestions';
import { toast } from '../ui/feedback';
import {
  type Engine, type FlimifyTab, type Msg,
  mkId, newTab, labelFromPrompt,
} from './flimifyModel';

type Props = {
  width: number;
  height: number;
  durationSec?: number;
  defaultEngine?: Engine;
  inject?: { text: string; id: number } | null;
  onRender: (clip: BridgeClip, prompt: string) => void;
  onImport: (clip: BridgeClip) => void;
  onPreview: (clip: BridgeClip) => void;
  onDelete: (clip: BridgeClip) => Promise<boolean>;
};

export const FlimifyPanel: React.FC<Props> = ({ width, height, durationSec = 4, defaultEngine = 'remotion', inject, onRender, onImport, onPreview, onDelete }) => {
  const [tabs, setTabs] = useState<FlimifyTab[]>(() => [newTab('animation', defaultEngine, 'default')]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const [, force] = useState(0); // re-render tick for the progress estimate
  const [outOpen, setOutOpen] = useState(false);
  const [engOpen, setEngOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  // keep the conversation scrolled to the latest message
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active.messages.length, active.busy, active.genStatus, activeId]);

  // patch one tab immutably
  const patch = (id: string, fn: (t: FlimifyTab) => FlimifyTab) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  // progress ticker while the active tab is generating
  useEffect(() => {
    if (!active.busy) return;
    const i = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(i);
  }, [active.busy, active.id]);

  // keep latest tabs/active for the global shortcut listener (bind once)
  const liveRef = useRef({ tabs, activeId });
  liveRef.current = { tabs, activeId };

  // "Use prompt" from History injects text into the active tab's draft
  useEffect(() => {
    if (!inject) return;
    patch(liveRef.current.activeId, (t) => ({ ...t, draft: inject.text }));
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inject?.id]);

  // ── keyboard shortcuts (ported from the extension) ──
  useEffect(() => {
    const typing = () => /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    const onKey = (e: KeyboardEvent) => {
      const { tabs: ts, activeId: aid } = liveRef.current;
      const idx = ts.findIndex((t) => t.id === aid);
      const meta = e.metaKey || e.ctrlKey;
      // ESC — interrupt the active tab's running generation
      if (e.key === 'Escape') {
        const cur = ts[idx];
        if (cur && cur.busy) { e.preventDefault(); cancelActive(cur.id); return; }
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const next = (idx + dir + ts.length) % ts.length;
        setActiveId(ts[next].id);
        return;
      }
      // Cmd/Ctrl+Shift+T — new animation tab ; +Shift+W — close active
      if (meta && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        const cur = ts[idx] || ts[0];
        const t = newTab('animation', cur.engine, cur.renderMode);
        setTabs((arr) => [...arr, t]); setActiveId(t.id); return;
      }
      if (meta && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        setTabs((arr) => {
          const next = arr.filter((t) => t.id !== aid);
          if (next.length === 0) { const t = newTab('animation', defaultEngine, 'default'); setActiveId(t.id); return [t]; }
          setActiveId(next[Math.max(0, idx - 1)].id);
          return next;
        });
        return;
      }
      // Cmd/Ctrl+1..9 — jump to tab N (only when not typing)
      if (meta && !e.shiftKey && !typing() && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10) - 1;
        if (ts[n]) { e.preventDefault(); setActiveId(ts[n].id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── tabs ──
  const addTab = (type: 'animation' | 'chat') => {
    const t = newTab(type, active.engine, active.renderMode);
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  };
  const closeTab = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) { const t = newTab('animation', defaultEngine, 'default'); setActiveId(t.id); return [t]; }
      if (id === activeId) setActiveId(next[Math.max(0, ts.findIndex((t) => t.id === id) - 1)].id);
      return next;
    });
  };
  const deleteAllRenders = async (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    const renders = t.messages.filter((m): m is Extract<Msg, { role: 'render' }> => m.role === 'render');
    let removed = 0;
    for (const r of renders) { if (await onDelete(r.clip)) removed++; }
    if (removed) patch(id, (tb) => ({ ...tb, messages: tb.messages.filter((m) => m.role !== 'render') }));
  };

  // ── suggestion chips ──
  const showHero = active.messages.length === 0;
  const chips = chipsFor(active.chipCat, active.chipQuery);
  const useChip = (p: string) => { patch(active.id, (t) => ({ ...t, draft: p })); requestAnimationFrame(() => inputRef.current?.focus()); };

  // ── prompt Expand (Low/Mid/High → bridge rewrites the brief) ──
  const expand = async (level: 'light' | 'medium' | 'heavy') => {
    const cur = liveRef.current.tabs.find((t) => t.id === activeId);
    if (!cur || cur.expanding || !cur.draft.trim()) return;
    patch(cur.id, (t) => ({ ...t, expanding: true }));
    try { const out = await expandPrompt(cur.draft.trim(), level); patch(cur.id, (t) => ({ ...t, draft: out })); }
    catch (e) { toast('Expand failed: ' + (e as Error).message, true); }
    finally { patch(cur.id, (t) => ({ ...t, expanding: false })); }
  };

  // ── ghost-text autocomplete (instant, from the suggestion library) ──
  const ghostFull = active.type === 'animation' ? ghostFor(active.draft) : null;
  const ghostTail = ghostFull ? ghostFull.slice(active.draft.trimStart().length) : '';
  const acceptGhost = () => { if (ghostFull) patch(active.id, (t) => ({ ...t, draft: ghostFull })); };

  // ── reference images (attach via native picker; drop on the input) ──
  const attachRef = async () => {
    const p = await window.flimify?.openVideo?.(); // native file dialog (any media)
    if (p) patch(active.id, (t) => ({ ...t, refs: [...t.refs, p] }));
  };
  const removeRef = (i: number) => patch(active.id, (t) => ({ ...t, refs: t.refs.filter((_, x) => x !== i) }));
  const onRefDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files.map((f) => window.flimify?.getPathForFile?.(f)).filter(Boolean) as string[];
    if (paths.length) { e.preventDefault(); patch(active.id, (t) => ({ ...t, refs: [...t.refs, ...paths] })); }
  };

  // ── generate ──
  // Hitting send while a tab is already rendering queues the prompt instead of
  // dropping it; the queue auto-drains FIFO when the in-flight render finishes.
  const send = () => {
    const cur = liveRef.current.tabs.find((t) => t.id === liveRef.current.activeId);
    if (!cur) return;
    const p = cur.draft.trim();
    if (!p) return;
    const iter = cur.iterate;
    patch(cur.id, (t) => ({ ...t, draft: '', iterate: null }));
    if (cur.busy) {
      patch(cur.id, (t) => ({ ...t, paused: false, queue: [...t.queue, { id: mkId('q'), text: p }] }));
      return;
    }
    // Plan mode ("Ask Questions") → interview before building.
    if (cur.planMode && cur.type === 'animation' && !iter) { startPlan(cur.id, p); return; }
    runGen(cur.id, p, iter);
  };

  // ── plan interview ──
  const startPlan = async (tabId: string, prompt: string) => {
    patch(tabId, (t) => ({ ...t, plan: { prompt, loading: true, questions: [], answers: {}, note: '' } }));
    let qs: Awaited<ReturnType<typeof planQuestions>> = [];
    try { qs = await planQuestions(prompt); } catch { qs = []; }
    if (qs.length === 0) { patch(tabId, (t) => ({ ...t, plan: null })); runGen(tabId, prompt, null); return; }
    const answers: Record<string, string> = {};
    qs.forEach((q) => { if (q.options?.[0]) answers[q.id] = q.options[0].value; });
    patch(tabId, (t) => (t.plan ? { ...t, plan: { ...t.plan, loading: false, questions: qs, answers } } : t));
  };
  const buildFromPlan = (tabId: string, withAnswers: boolean) => {
    const cur = liveRef.current.tabs.find((t) => t.id === tabId);
    if (!cur || !cur.plan) return;
    const { prompt, questions, answers, note } = cur.plan;
    let outbound = prompt;
    if (withAnswers && questions.length) {
      const lines = questions.map((q) => {
        const lab = q.options.find((o) => o.value === answers[q.id])?.label || answers[q.id];
        return `- ${q.q} ${lab}`;
      }).join('\n');
      outbound += `\n\n[MY CHOICES — build exactly to these]\n${lines}`;
    }
    if (note.trim()) outbound += `\n\n[EXTRA CONTEXT FROM ME]\n${note.trim()}`;
    patch(tabId, (t) => ({ ...t, plan: null }));
    runGen(tabId, outbound, null, prompt);
  };

  const runGen = async (tabId: string, p: string, iter: typeof active.iterate, displayPrompt?: string) => {
    const cur = liveRef.current.tabs.find((t) => t.id === tabId);
    if (!cur) return;
    const engine = cur.engine, mode = cur.renderMode, refs = cur.refs;
    const shown = displayPrompt || p;
    const n = iter ? 1 : Math.max(1, Math.min(10, cur.outputs));
    patch(tabId, (t) => ({
      ...t,
      busy: true,
      startedAt: Date.now(),
      genStatus: '',
      cancelled: false,
      label: t.messages.length === 0 && t.type === 'animation' ? labelFromPrompt(shown) : t.label,
      messages: [...t.messages, { id: mkId('m'), role: 'you', text: (iter ? '↳ ' : '') + shown + (n > 1 ? ` · ${n} versions` : '') }],
    }));
    const refLines = refs.length ? refs.map((r) => `[REFERENCE: ${r}]`).join('\n') + '\n' : '';
    const baseOutbound = refLines + (iter
      ? `Make a new version of a previous motion graphic.\nOriginal prompt: "${iter.prompt}"\nChange to make: ${p}\nKeep everything else the same unless the change implies otherwise.`
      : p);
    let cancelled = false;
    for (let i = 0; i < n; i++) {
      if (cancelled) break;
      const outbound = n > 1
        ? `${baseOutbound}\n\n[VERSION ${i + 1} OF ${n} — make THIS take distinct: different composition, layout and motion from the others, while still satisfying the prompt. Variation seed ${i + 1}/${n}.]`
        : baseOutbound;
      const reqId = newReqId();
      const ctrl = new AbortController();
      patch(tabId, (t) => ({ ...t, abort: ctrl, curReqId: reqId }));
      const unsub = onProgress(reqId, (text) => patch(tabId, (t) => (t.busy ? { ...t, genStatus: n > 1 ? `v${i + 1}/${n} · ${text}` : text } : t)));
      try {
        const clip = await generate(outbound, engine, width, height, durationSec, mode, reqId, ctrl.signal);
        onRender(clip, iter ? iter.prompt + ' · ' + p : shown);
        patch(tabId, (t) => ({ ...t, messages: [...t.messages, { id: mkId('m'), role: 'render', clip, prompt: shown, status: n > 1 ? `Version ${i + 1}/${n} · not imported` : 'Ready · not imported', imported: false }] }));
      } catch (e) {
        const aborted = ctrl.signal.aborted || (e as Error).name === 'AbortError';
        cancelled = aborted;
        patch(tabId, (t) => ({ ...t, messages: [...t.messages, { id: mkId('m'), role: 'flimify', text: aborted ? '⏹ Stopped.' : '✗ ' + (e as Error).message, continuePrompt: shown }] }));
      } finally {
        unsub();
      }
    }
    // finished/cancelled → clear the abort handle, drain the queue (unless cancelled)
    let next: { id: string; text: string } | null = null;
    setTabs((arr) => arr.map((t) => {
      if (t.id !== tabId) return t;
      const base = { ...t, busy: false, abort: null, curReqId: '', genStatus: '' };
      if (!cancelled && !t.paused && t.queue.length) { next = t.queue[0]; return { ...base, queue: t.queue.slice(1) }; }
      return { ...base, paused: cancelled ? true : t.paused };
    }));
    if (next) runGen(tabId, (next as { id: string; text: string }).text, null);
  };

  // ── interrupt the in-flight generation (ESC / Stop button) ──
  const cancelActive = (tabId: string) => {
    const cur = liveRef.current.tabs.find((t) => t.id === tabId);
    if (!cur || !cur.busy) return;
    try { cur.abort?.abort(); } catch { /* ignore */ }
    if (cur.curReqId) cancelGeneration(cur.curReqId);
  };
  const continueFrom = (prompt: string) => { const cur = liveRef.current.tabs.find((t) => t.id === activeId); if (cur && !cur.busy) runGen(cur.id, prompt, null); };

  const removeQueued = (qid: string) => patch(active.id, (t) => ({ ...t, queue: t.queue.filter((q) => q.id !== qid) }));
  const runQueueNow = () => {
    const cur = liveRef.current.tabs.find((t) => t.id === activeId);
    if (!cur || cur.busy || !cur.queue.length) return;
    const head = cur.queue[0];
    patch(cur.id, (t) => ({ ...t, paused: false, queue: t.queue.slice(1) }));
    runGen(cur.id, head.text, null);
  };

  // render-card actions
  const importCard = (m: Extract<Msg, { role: 'render' }>) => {
    onImport(m.clip);
    patch(active.id, (t) => ({ ...t, messages: t.messages.map((x) => (x.id === m.id && x.role === 'render' ? { ...x, status: 'Imported to timeline', imported: true } : x)) }));
  };
  const changesCard = (m: Extract<Msg, { role: 'render' }>) => {
    patch(active.id, (t) => ({ ...t, iterate: { prompt: m.prompt, src: m.clip.src, name: m.clip.name } }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const deleteCard = async (m: Extract<Msg, { role: 'render' }>) => {
    const ok = await onDelete(m.clip);
    if (ok) patch(active.id, (t) => ({ ...t, messages: t.messages.filter((x) => x.id !== m.id) }));
  };

  // progress estimate for the active busy tab
  const elapsed = active.busy ? Math.floor((Date.now() - active.startedAt) / 1000) : 0;
  const progress = active.busy ? Math.min(0.95, 1 - Math.exp(-elapsed / 22)) : 0;

  const renderCount = active.messages.filter((m) => m.role === 'render').length;

  return (
    <div className={'flimify-panel' + (active.type === 'chat' ? ' chat-mode' : '')}>
      {/* tab strip */}
      <div className="fp-tabs">
        <div className="fp-tabstrip">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={'fp-tab' + (t.id === activeId ? ' active' : '')}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } else setActiveId(t.id); }}
              title={t.label}
            >
              {t.busy && <span className="fp-tabdot" />}
              {t.type === 'chat' && (
                <svg className="fp-tabchat" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              )}
              <span className="fp-tablabel">{t.label}</span>
              {t.id === activeId && renderCount > 0 && (
                <button className="fp-tabdelall" title="Delete all renders in this tab" onClick={(e) => { e.stopPropagation(); deleteAllRenders(t.id); }}>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
              )}
              <button className="fp-tabclose" title="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>✕</button>
            </div>
          ))}
        </div>
        <button className="fp-newtab" title="New animation tab" onClick={() => addTab('animation')}>+</button>
        <button className="fp-newtab chat" title="New chat tab" onClick={() => addTab('chat')}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </button>
      </div>

      {active.type === 'animation' && (
        <div className="fp-modebar">
          <div className="fp-mode">
            {(['fast', 'default', 'slow'] as const).map((m) => (
              <button key={m} className={active.renderMode === m ? 'on' : ''} onClick={() => patch(active.id, (t) => ({ ...t, renderMode: m }))} title={m === 'fast' ? 'Quick template-based (~1 min)' : m === 'slow' ? 'Best quality — explores + polishes (~3-5 min)' : 'A real custom-built animation (~2 min)'}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className={'fp-eng' + (engOpen ? ' open' : '')}>
            <button className="fp-eng-btn" onClick={() => setEngOpen((o) => !o)} title="Render engine">
              {active.engine === 'remotion' ? 'Remotion' : 'HyperFrames'} <span className="fp-eng-caret">⌄</span>
            </button>
            {engOpen && (
              <div className="fp-eng-menu">
                <button className={active.engine === 'remotion' ? 'on' : ''} onClick={() => { patch(active.id, (t) => ({ ...t, engine: 'remotion' })); setEngOpen(false); }}>Remotion<span>React motion graphics</span></button>
                <button className={active.engine === 'hyperframes' ? 'on' : ''} onClick={() => { patch(active.id, (t) => ({ ...t, engine: 'hyperframes' })); setEngOpen(false); }}>HyperFrames<span>HTML/CSS/GSAP blocks</span></button>
              </div>
            )}
          </div>
        </div>
      )}

      {showHero ? (
        active.type === 'animation' ? (
          <div className="fp-hero">
            <div className="fp-hero-top">
              <div className="fp-hero-logo">F</div>
              <h1>Your editing copilot</h1>
              <p>Ask for motion graphics, intros, or lower thirds. They render and drop onto your timeline.</p>
              <div className="fp-hero-search">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input value={active.chipQuery} onChange={(e) => patch(active.id, (t) => ({ ...t, chipQuery: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Escape') patch(active.id, (t) => ({ ...t, chipQuery: '' })); }} placeholder="Search suggestions…" />
              </div>
            </div>
            {!active.chipQuery && (
              <div className="fp-chipnav">
                {CATEGORIES.map((c) => (
                  <button key={c} className={'fp-navpill' + (c === active.chipCat ? ' active' : '') + (c === 'Popular' ? ' pop' : '')} onClick={() => patch(active.id, (t) => ({ ...t, chipCat: c }))}>
                    {c === 'Popular' ? '★ Popular' : c}
                  </button>
                ))}
              </div>
            )}
            <div className="fp-chips-wrap">
              {!active.chipQuery && <div className="fp-chip-cat">{active.chipCat === 'Popular' ? 'Popular' : active.chipCat}</div>}
              <div className="fp-chips">
                {chips.length === 0 && <div className="fp-nomatch">No matches.</div>}
                {chips.map((s) => (
                  <button key={s.label + s.cat} className="fp-chip" title={s.prompt} onClick={() => useChip(s.prompt)}>{s.label}</button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="fp-chatempty">
            <div className="fp-hero-logo">💬</div>
            <h1>Free chat with Flimify</h1>
            <p>Ask anything — no render pipeline. Switch to an animation tab to generate graphics.</p>
          </div>
        )
      ) : (
        <div className="fp-log" ref={logRef}>
          {active.messages.map((m) => {
            const who = m.role === 'render' ? 'flimify' : m.role;
            return (
              <div key={m.id} className={'msg ' + who}>
                <div className="avatar">{who === 'you' ? 'Y' : 'F'}</div>
                <div className="msg-content">
                  <div className="msg-author">{who === 'you' ? 'You' : 'Flimify'}</div>
                  <div className="msg-body">
                    {m.role === 'render' ? (
                      <div className="fp-card">
                        <div className="fp-card-prev" onClick={() => onPreview(m.clip)} title="Preview">
                          <video src={m.clip.src} muted loop playsInline onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})} onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()} />
                          <span className="fp-card-play">▶</span>
                        </div>
                        <div className="fp-card-meta"><b>{m.clip.name}</b><span>{m.status}</span></div>
                        <div className="fp-card-actions">
                          <button className="fp-card-btn primary" onClick={() => importCard(m)} title={m.imported ? 'Drop another copy on the timeline' : undefined}>{m.imported ? 'Import again' : 'Import to Timeline'}</button>
                          <button className="fp-card-btn" onClick={() => onPreview(m.clip)}>Preview</button>
                          <button className="fp-card-btn" onClick={() => changesCard(m)}>Changes</button>
                          <button className="fp-card-btn danger" onClick={() => deleteCard(m)}>Delete</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span>{m.text}</span>
                        {m.role === 'flimify' && m.continuePrompt && (
                          <button className="fp-continue" onClick={() => continueFrom(m.continuePrompt!)}>↻ Continue</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {active.busy && (
            <div className="msg flimify">
              <div className="avatar">F</div>
              <div className="msg-content">
                <div className="msg-author">Flimify</div>
                <div className="msg-body">
                  <div className="thinking-stack">
                    <div className="thinking-row">
                      <span className="orbit"><span /><span /><span /></span>
                      <span className="orbit-label">{active.genStatus || 'Working'}</span>
                      <span className="thinking-elapsed">{elapsed}s</span>
                      <span className="interrupt-hint">ESC to interrupt</span>
                    </div>
                    <div className="progress-bar"><div className="progress-bar-fill" style={{ width: (progress * 100).toFixed(1) + '%' }} /></div>
                    <div className="thinking-sub">running on your Claude — no API key</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* plan interview card */}
      {active.plan && (
        <div className="fp-plan">
          {active.plan.loading ? (
            <div className="fp-plan-loading"><span className="fp-spin" /> Thinking of a few quick questions…</div>
          ) : (
            <>
              <div className="fp-plan-head">A few quick questions</div>
              {active.plan.questions.map((q) => (
                <div className="fp-plan-q" key={q.id}>
                  <div className="fp-plan-qt">{q.q}</div>
                  <div className="fp-plan-opts">
                    {q.options.map((o) => (
                      <button key={o.value} className={active.plan!.answers[q.id] === o.value ? 'on' : ''} onClick={() => patch(active.id, (t) => (t.plan ? { ...t, plan: { ...t.plan, answers: { ...t.plan.answers, [q.id]: o.value } } } : t))}>{o.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              <textarea className="fp-plan-note" placeholder="Anything else? (optional)" value={active.plan.note} onChange={(e) => patch(active.id, (t) => (t.plan ? { ...t, plan: { ...t.plan, note: e.target.value } } : t))} rows={2} />
              <div className="fp-plan-actions">
                <button className="fp-plan-skip" onClick={() => buildFromPlan(active.id, false)}>Skip & build now</button>
                <button className="fp-plan-build" onClick={() => buildFromPlan(active.id, true)}>Build it</button>
              </div>
            </>
          )}
        </div>
      )}

      {active.refs.length > 0 && (
        <div className="fp-refbar">
          {active.refs.map((r, i) => (
            <span className="fp-ref" key={i} title={r}>{r.split('/').pop()}<button onClick={() => removeRef(i)}>✕</button></span>
          ))}
        </div>
      )}

      {active.type === 'animation' && !active.iterate && !active.plan && (
        <div className="fp-extras">
          <div className={'fp-out' + (outOpen ? ' open' : '')}>
            <button className="fp-out-btn" onClick={() => setOutOpen((o) => !o)} title="How many versions to generate from one prompt">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              ×{active.outputs}
            </button>
            {outOpen && (
              <div className="fp-out-menu">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} className={active.outputs === n ? 'on' : ''} onClick={() => { patch(active.id, (t) => ({ ...t, outputs: n })); setOutOpen(false); }}>{n}</button>
                ))}
                <div className="fp-out-hint">versions per prompt</div>
              </div>
            )}
          </div>
          <button className={'fp-pill' + (active.planMode ? ' on' : '')} onClick={() => patch(active.id, (t) => ({ ...t, planMode: !t.planMode }))} title="Ask a few questions before building">Ask Questions</button>
          <button className="fp-pill" onClick={attachRef} title="Attach a reference image">+ Reference</button>
          <div className="fp-expand" title="Flesh out the prompt — adds detail to your prompt">
            <span className="fp-expand-label">EXTEND</span>
            {active.expanding ? <span className="fp-spin" /> : (['light', 'medium', 'heavy'] as const).map((lv) => (
              <button key={lv} onClick={() => expand(lv)} disabled={!active.draft.trim()} title={lv === 'light' ? 'Low' : lv === 'medium' ? 'Mid' : 'High'}>{lv === 'light' ? 'Low' : lv === 'medium' ? 'Mid' : 'High'}</button>
            ))}
          </div>
        </div>
      )}

      {active.iterate && (
        <div className="fp-iterbar">
          <span>Iterating on <b>{active.iterate.name}</b></span>
          <button onClick={() => patch(active.id, (t) => ({ ...t, iterate: null }))} title="Cancel">✕</button>
        </div>
      )}

      {active.queue.length > 0 && (
        <div className="fp-queue">
          <div className="fp-queue-head">
            <span>Queue · {active.queue.length}</span>
            {!active.busy && <button className="fp-queue-run" onClick={runQueueNow}>▶ Run</button>}
          </div>
          {active.queue.map((q, i) => (
            <div key={q.id} className={'fp-queue-item' + (i === 0 && active.busy ? ' running' : '')}>
              <span>{q.text.length > 56 ? q.text.slice(0, 56) + '…' : q.text}</span>
              <button onClick={() => removeQueued(q.id)} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="fp-input" onDragOver={(e) => { if (Array.from(e.dataTransfer?.items || []).some((i) => i.kind === 'file')) e.preventDefault(); }} onDrop={onRefDrop}>
        <div className="fp-ta-wrap">
          {ghostTail && (
            <div className="fp-ghost" aria-hidden><span className="fp-ghost-typed">{active.draft}</span><span className="fp-ghost-tail">{ghostTail}</span></div>
          )}
          <textarea
            ref={inputRef}
            value={active.draft}
            onChange={(e) => patch(active.id, (t) => ({ ...t, draft: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
              if (ghostTail && e.key === 'Tab') { e.preventDefault(); acceptGhost(); return; }
              const el = e.currentTarget;
              if (ghostTail && e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); acceptGhost(); }
            }}
            placeholder={active.type === 'chat' ? 'Message Flimify…' : active.busy ? 'Queue another prompt…' : active.iterate ? 'What to change?' : 'Ask Flimify…'}
            rows={2}
          />
        </div>
        <div className="fp-input-foot">
          {active.busy ? (
            <>
              <span className="fp-hint">Enter to queue · <b>Esc</b> to stop</span>
              {active.draft.trim() && <button className="fp-send fp-queue-btn" onClick={send}>Add to queue</button>}
              <button className="fp-stop" onClick={() => cancelActive(active.id)} title="Interrupt (Esc)" aria-label="Stop">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            </>
          ) : (
            <>
              <span className="fp-hint fp-kbd">{ghostTail ? '↹ Tab to complete' : 'Tab accept · Enter send · ⌘V paste · ⌘C copy'}</span>
              <button className="fp-send" onClick={send} disabled={!active.draft.trim()}>
                {active.iterate ? 'Apply changes' : active.type === 'chat' ? 'Send' : 'Generate'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
