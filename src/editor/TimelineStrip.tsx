// Interactive timeline: ruler, track rows, clip blocks, playhead. Click empty
// space to seek; click a clip to select; drag its body to move; drag an edge to
// trim (video clips also adjust trimBefore on a left-trim). Synced to the Player.
import { useEffect, useRef } from 'react';
import type { Clip, EditorState } from './types';

const PX_PER_FRAME = 5;
const TRACK_H = 46;
const RULER_H = 26;
const EDGE = 9;

type Patch = Partial<Pick<Clip, 'from' | 'durationInFrames'>> & { trimBefore?: number };

type Drag = {
  trackId: string;
  clipId: string;
  mode: 'move' | 'trim-left' | 'trim-right';
  startX: number;
  startFrom: number;
  startDur: number;
  startTrim: number | null;
};

export const TimelineStrip: React.FC<{
  state: EditorState;
  currentFrame: number;
  onSeek: (frame: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateClip: (trackId: string, clipId: string, patch: Patch) => void;
}> = ({ state, currentFrame, onSeek, selectedId, onSelect, onUpdateClip }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const totalW = state.durationInFrames * PX_PER_FRAME;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxFrames = Math.round((e.clientX - d.startX) / PX_PER_FRAME);
      if (d.mode === 'move') {
        onUpdateClip(d.trackId, d.clipId, { from: Math.max(0, d.startFrom + dxFrames) });
      } else if (d.mode === 'trim-right') {
        onUpdateClip(d.trackId, d.clipId, { durationInFrames: Math.max(5, d.startDur + dxFrames) });
      } else {
        const newFrom = Math.max(0, d.startFrom + dxFrames);
        const delta = newFrom - d.startFrom;
        const patch: Patch = { from: newFrom, durationInFrames: Math.max(5, d.startDur - delta) };
        if (d.startTrim != null) patch.trimBefore = Math.max(0, d.startTrim + delta);
        onUpdateClip(d.trackId, d.clipId, patch);
      }
    };
    const onUp = () => { dragRef.current = null; document.body.style.cursor = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [onUpdateClip]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    onSelect(null);
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    onSeek(Math.max(0, Math.min(state.durationInFrames, Math.round(x / PX_PER_FRAME))));
  };

  const onClipDown = (e: React.MouseEvent, trackId: string, clip: Clip) => {
    e.stopPropagation();
    onSelect(clip.id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const mode = offX < EDGE ? 'trim-left' : offX > rect.width - EDGE ? 'trim-right' : 'move';
    dragRef.current = {
      trackId, clipId: clip.id, mode, startX: e.clientX,
      startFrom: clip.from, startDur: clip.durationInFrames,
      startTrim: clip.kind === 'video' ? (clip.trimBefore || 0) : null,
    };
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
  };

  const ticks: number[] = [];
  for (let f = 0; f <= state.durationInFrames; f += state.fps) ticks.push(f);

  return (
    <div className="tl" ref={wrapRef} onMouseDown={seekFromEvent}>
      <div className="tl-inner" style={{ width: totalW }}>
        <div className="tl-ruler" style={{ height: RULER_H }}>
          {ticks.map((f) => (
            <div key={f} className="tl-tick" style={{ left: f * PX_PER_FRAME }}>
              <span>{Math.round(f / state.fps)}s</span>
            </div>
          ))}
        </div>

        {[...state.tracks].reverse().map((track) => (
          <div className="tl-track" key={track.id} style={{ height: TRACK_H }}>
            <div className="tl-track-label">{track.label}</div>
            {track.clips.map((clip) => (
              <div
                key={clip.id}
                className={'tl-clip ' + clip.kind + (selectedId === clip.id ? ' sel' : '')}
                style={{ left: clip.from * PX_PER_FRAME, width: clip.durationInFrames * PX_PER_FRAME }}
                title={clip.name}
                onMouseDown={(e) => onClipDown(e, track.id, clip)}
              >
                <span>{clip.name}</span>
              </div>
            ))}
          </div>
        ))}

        <div
          className="tl-playhead"
          style={{ left: currentFrame * PX_PER_FRAME, height: RULER_H + state.tracks.length * TRACK_H }}
        />
      </div>
    </div>
  );
};
