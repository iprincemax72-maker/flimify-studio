// The Flimify AI panel — docked in the editor. Prompt → the local studio-bridge
// spawns Claude → renders an alpha overlay → it drops onto the timeline. The
// no-API-key generation model from the Premiere extension, now in the app —
// including the empty-state hero + suggestion-chip browser.
import { useEffect, useRef, useState } from 'react';
import { generate, type BridgeClip } from '../api';
import { CATEGORIES, chipsFor } from '../suggestions';

type Engine = 'remotion' | 'hyperframes';

export const FlimifyPanel: React.FC<{
  width: number;
  height: number;
  durationSec?: number;
  defaultEngine?: Engine;
  onClip: (clip: BridgeClip) => void;
}> = ({ width, height, durationSec = 4, defaultEngine = 'remotion', onClip }) => {
  const [prompt, setPrompt] = useState('');
  const [engine, setEngine] = useState<Engine>(defaultEngine);
  const [mode, setMode] = useState<'fast' | 'default' | 'slow'>('default');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState<{ role: 'you' | 'flimify'; text: string }[]>([]);
  const [chipCat, setChipCat] = useState('Popular');
  const [chipQuery, setChipQuery] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showHero = log.length === 0;
  const chips = chipsFor(chipCat, chipQuery);

  // Estimated progress bar (no real telemetry from the CLI, so it eases toward
  // ~95% and snaps to done on completion — same feel as the extension).
  useEffect(() => {
    if (!busy) return;
    setProgress(0.02);
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setProgress((p) => Math.min(0.95, p + (0.95 - p) * 0.025));
    }, 200);
    return () => clearInterval(id);
  }, [busy]);

  const useChip = (p: string) => {
    setPrompt(p);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const send = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setPrompt('');
    setLog((l) => [...l, { role: 'you', text: p }]);
    setBusy(true);
    try {
      const clip = await generate(p, engine, width, height, durationSec, mode);
      onClip(clip);
      setLog((l) => [...l, { role: 'flimify', text: '✓ Added “' + clip.name + '” to the timeline.' }]);
    } catch (e) {
      setLog((l) => [...l, { role: 'flimify', text: '✗ ' + (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flimify-panel">
      <div className="fp-engine">
        <button className={engine === 'remotion' ? 'on' : ''} onClick={() => setEngine('remotion')}>Remotion</button>
        <button className={engine === 'hyperframes' ? 'on' : ''} onClick={() => setEngine('hyperframes')}>HyperFrames</button>
      </div>
      <div className="fp-mode">
        {(['fast', 'default', 'slow'] as const).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={m === 'fast' ? 'Quick, simple' : m === 'slow' ? 'Layered, polished (slower)' : 'A real custom graphic'}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {showHero ? (
        <div className="fp-hero">
          <div className="fp-hero-top">
            <div className="fp-hero-logo">F</div>
            <h1>Your editing copilot</h1>
            <p>Ask for motion graphics, intros, or lower thirds. They render and drop onto your timeline.</p>
            <div className="fp-hero-search">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                value={chipQuery}
                onChange={(e) => setChipQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setChipQuery(''); }}
                placeholder="Search suggestions…"
              />
            </div>
          </div>
          {!chipQuery && (
            <div className="fp-chipnav">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  className={'fp-navpill' + (c === chipCat ? ' active' : '') + (c === 'Popular' ? ' pop' : '')}
                  onClick={() => setChipCat(c)}
                >
                  {c === 'Popular' ? '★ Popular' : c}
                </button>
              ))}
            </div>
          )}
          <div className="fp-chips">
            {chips.length === 0 && <div className="fp-nomatch">No matches.</div>}
            {chips.map((s) => (
              <button key={s.label + s.cat} className="fp-chip" title={s.prompt} onClick={() => useChip(s.prompt)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="fp-log">
          {log.map((m, i) => (
            <div key={i} className={'fp-msg ' + m.role}>{m.text}</div>
          ))}
        </div>
      )}

      {busy && (
        <div className="fp-gen">
          <div className="fp-gen-top">
            <span className="fp-gen-label"><span className="fp-spin" /> Generating…</span>
            <span className="fp-gen-elapsed">{elapsed}s</span>
          </div>
          <div className="fp-gen-bar"><i style={{ width: (progress * 100).toFixed(1) + '%' }} /></div>
          <div className="fp-gen-sub">running on your Claude — no API key</div>
        </div>
      )}

      <div className="fp-input">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask Flimify…"
          disabled={busy}
          rows={2}
        />
        <button className="fp-send" onClick={send} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </div>
  );
};
