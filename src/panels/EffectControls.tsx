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
  const clamp = (v: number) => { if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); return +v.toFixed(dp); };
  const commit = () => { const v = parseFloat(draft); if (!isNaN(v)) onChange(clamp(v)); setEditing(false); };
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startV = value;
    const move = (ev: MouseEvent) => onChange(clamp(startV + (ev.clientX - startX) * step));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('scrubbing'); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    document.body.classList.add('scrubbing');
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

export const EffectControls: React.FC<{
  clip: Clip | null;
  onChange: (patch: Partial<ClipTransform>) => void;
}> = ({ clip, onChange }) => {
  if (!clip || clip.kind === 'audio') {
    return <div className="fx-empty">Select a clip on the timeline to edit its position, scale, rotation, and opacity.</div>;
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
    </div>
  );
};
