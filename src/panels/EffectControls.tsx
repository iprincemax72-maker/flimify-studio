// Effect Controls — Premiere-style transform editor for the selected clip.
// Scoped to Position (X/Y), Scale, Rotation, Opacity. Values are scrubbable
// (drag left/right) and double-click to type. Edits flow straight into the
// clip's transform, so the preview + export update live.
import { useState } from 'react';
import { DEFAULT_TRANSFORM, type Clip, type ClipTransform } from '../editor/types';

const ResetIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /></svg>
);

// drag-to-scrub number; double-click to type
const ScrubNumber: React.FC<{
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; dp?: number; suffix?: string;
}> = ({ value, onChange, step = 1, min, max, dp = 0, suffix = '' }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const lim = (v: number) => { if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); return v; };
  const clamp = (v: number) => +lim(v).toFixed(dp);
  const commit = () => { const v = parseFloat(draft); if (!isNaN(v)) onChange(clamp(v)); setEditing(false); };
  // Premiere-style scrub: pointer-lock hides the cursor, then drag up/right to
  // raise and down/left to lower — infinitely (no edge limits).
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let acc = value;
    const target = e.currentTarget as HTMLElement;
    try { target.requestPointerLock?.(); } catch { /* ignore */ }
    document.body.classList.add('scrubbing');
    const move = (ev: MouseEvent) => {
      // up (-movementY) and right (+movementX) both increase the value
      acc = lim(acc + ((ev.movementX || 0) - (ev.movementY || 0)) * step);
      onChange(+acc.toFixed(dp));
    };
    const up = () => {
      try { document.exitPointerLock?.(); } catch { /* ignore */ }
      document.body.classList.remove('scrubbing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (editing) {
    return <input className="fx-num-input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }} />;
  }
  return (
    <span className="fx-num" onMouseDown={onDown} onDoubleClick={() => { setDraft(String(value)); setEditing(true); }} title="Drag to change · double-click to type">
      {value.toFixed(dp)}{suffix}
    </span>
  );
};

const Row: React.FC<{ label: string; onReset: () => void; children: React.ReactNode }> = ({ label, onReset, children }) => (
  <div className="fx-row">
    <span className="fx-label">{label}</span>
    <span className="fx-vals">{children}</span>
    <button className="fx-reset" onClick={onReset} title="Reset">
      <ResetIcon />
    </button>
  </div>
);

const FadeGroup: React.FC<{ clip: Clip; onFade: (p: { fadeIn?: number; fadeOut?: number }) => void }> = ({ clip, onFade }) => (
  <div className="fx-group">
    <div className="fx-group-h">Fade (frames)</div>
    <Row label="In" onReset={() => onFade({ fadeIn: 0 })}>
      <ScrubNumber value={clip.fadeIn ?? 0} onChange={(f) => onFade({ fadeIn: Math.max(0, f) })} step={1} min={0} max={600} dp={0} suffix=" f" />
    </Row>
    <Row label="Out" onReset={() => onFade({ fadeOut: 0 })}>
      <ScrubNumber value={clip.fadeOut ?? 0} onChange={(f) => onFade({ fadeOut: Math.max(0, f) })} step={1} min={0} max={600} dp={0} suffix=" f" />
    </Row>
  </div>
);

export const EffectControls: React.FC<{
  clip: Clip | null;
  onChange: (patch: Partial<ClipTransform>) => void;
  onAudio: (gainDb: number) => void;
  onFade: (patch: { fadeIn?: number; fadeOut?: number }) => void;
}> = ({ clip, onChange, onAudio, onFade }) => {
  if (!clip) {
    return <div className="fx-empty">Select a clip on the timeline to edit it.</div>;
  }
  if (clip.kind === 'audio') {
    const db = clip.gainDb ?? 0;
    return (
      <div className="fx">
        <div className="fx-clip" title={clip.name}>{clip.name}</div>
        <div className="fx-group">
          <div className="fx-group-h">Volume</div>
          <Row label="Level" onReset={() => onAudio(0)}>
            <ScrubNumber value={db} onChange={onAudio} step={0.2} min={-60} max={12} dp={1} suffix=" dB" />
          </Row>
        </div>
        <FadeGroup clip={clip} onFade={onFade} />
      </div>
    );
  }
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  return (
    <div className="fx">
      <div className="fx-clip" title={clip.name}>{clip.name}</div>

      <div className="fx-group">
        <div className="fx-group-h">Motion</div>
        <Row label="Position" onReset={() => onChange({ x: 0, y: 0 })}>
          <ScrubNumber value={t.x} onChange={(x) => onChange({ x })} />
          <ScrubNumber value={t.y} onChange={(y) => onChange({ y })} />
        </Row>
        <Row label="Scale" onReset={() => onChange({ scale: 100 })}>
          <ScrubNumber value={t.scale} onChange={(scale) => onChange({ scale })} step={0.5} min={0} max={1000} dp={1} suffix=" %" />
        </Row>
        <Row label="Rotation" onReset={() => onChange({ rotation: 0 })}>
          <ScrubNumber value={t.rotation} onChange={(rotation) => onChange({ rotation })} dp={0} suffix="°" />
        </Row>
      </div>

      <div className="fx-group">
        <div className="fx-group-h">Opacity</div>
        <Row label="Opacity" onReset={() => onChange({ opacity: 100 })}>
          <ScrubNumber value={t.opacity} onChange={(opacity) => onChange({ opacity })} step={0.5} min={0} max={100} dp={1} suffix=" %" />
        </Row>
      </div>

      <FadeGroup clip={clip} onFade={onFade} />
    </div>
  );
};
