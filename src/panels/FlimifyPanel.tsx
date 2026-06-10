// The Flimify AI panel — docked in the editor. Multi-conversation tabs (each its
// own thread, draft, render mode + engine), an empty-state hero with the
// suggestion-chip browser, and in-chat render cards with Import / Preview /
// Changes / Delete — a 1:1 port of the Premiere extension, on the no-API-key
// local-Claude model.
import { useEffect, useRef, useState } from 'react';
import { generate, type BridgeClip } from '../api';
import { CATEGORIES, chipsFor } from '../suggestions';
import {
  type Engine, type FlimifyTab, type Msg,
  mkId, newTab, labelFromPrompt,
} from './flimifyModel';

type Props = {
  width: number;
  height: number;
  durationSec?: number;
  defaultEngine?: Engine;
  onRender: (clip: BridgeClip, prompt: string) => void;
  onImport: (clip: BridgeClip) => void;
  onPreview: (clip: BridgeClip) => void;
  onDelete: (clip: BridgeClip) => Promise<boolean>;
};

export const FlimifyPanel: React.FC<Props> = ({ width, height, durationSec = 4, defaultEngine = 'remotion', onRender, onImport, onPreview, onDelete }) => {
  const [tabs, setTabs] = useState<FlimifyTab[]>(() => [newTab('animation', defaultEngine, 'default')]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);
  const [, force] = useState(0); // re-render tick for the progress estimate
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  // patch one tab immutably
  const patch = (id: string, fn: (t: FlimifyTab) => FlimifyTab) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  // progress ticker while the active tab is generating
  useEffect(() => {
    if (!active.busy) return;
    const i = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(i);
  }, [active.busy, active.id]);

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

  // ── generate ──
  const send = async () => {
    const p = active.draft.trim();
    if (!p || active.busy) return;
    const tabId = active.id;
    const iter = active.iterate;
    const firstPrompt = active.messages.length === 0;
    patch(tabId, (t) => ({
      ...t,
      draft: '',
      iterate: null,
      busy: true,
      startedAt: Date.now(),
      label: firstPrompt && t.type === 'animation' ? labelFromPrompt(p) : t.label,
      messages: [...t.messages, { id: mkId('m'), role: 'you', text: (iter ? '↳ ' : '') + p }],
    }));
    // When iterating ("Changes"), send a fuller brief so the new render is a
    // tweak of the previous one rather than a from-scratch reinterpretation.
    const outbound = iter
      ? `Make a new version of a previous motion graphic.\nOriginal prompt: "${iter.prompt}"\nChange to make: ${p}\nKeep everything else the same unless the change implies otherwise.`
      : p;
    try {
      const clip = await generate(outbound, active.engine, width, height, durationSec, active.renderMode);
      onRender(clip, iter ? iter.prompt + ' · ' + p : p);
      patch(tabId, (t) => ({
        ...t,
        busy: false,
        messages: [...t.messages, { id: mkId('m'), role: 'render', clip, prompt: p, status: 'Ready · not imported', imported: false }],
      }));
    } catch (e) {
      patch(tabId, (t) => ({
        ...t,
        busy: false,
        messages: [...t.messages, { id: mkId('m'), role: 'flimify', text: '✗ ' + (e as Error).message }],
      }));
    }
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
        <>
          <div className="fp-engine">
            <button className={active.engine === 'remotion' ? 'on' : ''} onClick={() => patch(active.id, (t) => ({ ...t, engine: 'remotion' }))}>Remotion</button>
            <button className={active.engine === 'hyperframes' ? 'on' : ''} onClick={() => patch(active.id, (t) => ({ ...t, engine: 'hyperframes' }))}>HyperFrames</button>
          </div>
          <div className="fp-mode">
            {(['fast', 'default', 'slow'] as const).map((m) => (
              <button key={m} className={active.renderMode === m ? 'on' : ''} onClick={() => patch(active.id, (t) => ({ ...t, renderMode: m }))} title={m === 'fast' ? 'Quick template-based (~1 min)' : m === 'slow' ? 'Best quality — explores + polishes (~3-5 min)' : 'A real custom-built animation (~2 min)'}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </>
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
            <div className="fp-chips">
              {chips.length === 0 && <div className="fp-nomatch">No matches.</div>}
              {chips.map((s) => (
                <button key={s.label + s.cat} className="fp-chip" title={s.prompt} onClick={() => useChip(s.prompt)}>{s.label}</button>
              ))}
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
        <div className="fp-log">
          {active.messages.map((m) => {
            if (m.role === 'render') {
              return (
                <div key={m.id} className="fp-card">
                  <div className="fp-card-prev" onClick={() => onPreview(m.clip)} title="Preview">
                    <video src={m.clip.src} muted loop playsInline onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})} onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()} />
                    <span className="fp-card-play">▶</span>
                  </div>
                  <div className="fp-card-meta">
                    <b>{m.clip.name}</b>
                    <span>{m.status}</span>
                  </div>
                  <div className="fp-card-actions">
                    <button className="fp-card-btn primary" onClick={() => importCard(m)} disabled={m.imported}>{m.imported ? 'Imported' : 'Import to Timeline'}</button>
                    <button className="fp-card-btn" onClick={() => onPreview(m.clip)}>Preview</button>
                    <button className="fp-card-btn" onClick={() => changesCard(m)}>Changes</button>
                    <button className="fp-card-btn danger" onClick={() => deleteCard(m)}>Delete</button>
                  </div>
                </div>
              );
            }
            return <div key={m.id} className={'fp-msg ' + m.role}>{m.text}</div>;
          })}
        </div>
      )}

      {active.busy && (
        <div className="fp-gen">
          <div className="fp-gen-top">
            <span className="fp-gen-label"><span className="fp-spin" /> Generating…</span>
            <span className="fp-gen-elapsed">{elapsed}s</span>
          </div>
          <div className="fp-gen-bar"><i style={{ width: (progress * 100).toFixed(1) + '%' }} /></div>
          <div className="fp-gen-sub">running on your Claude — no API key</div>
        </div>
      )}

      {active.iterate && (
        <div className="fp-iterbar">
          <span>Iterating on <b>{active.iterate.name}</b></span>
          <button onClick={() => patch(active.id, (t) => ({ ...t, iterate: null }))} title="Cancel">✕</button>
        </div>
      )}

      <div className="fp-input">
        <textarea
          ref={inputRef}
          value={active.draft}
          onChange={(e) => patch(active.id, (t) => ({ ...t, draft: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={active.type === 'chat' ? 'Message Flimify…' : active.iterate ? 'What to change?' : 'Ask Flimify…'}
          disabled={active.busy}
          rows={2}
        />
        <button className="fp-send" onClick={send} disabled={active.busy || !active.draft.trim()}>
          {active.busy ? 'Generating…' : active.iterate ? 'Apply changes' : active.type === 'chat' ? 'Send' : 'Generate'}
        </button>
      </div>
    </div>
  );
};
