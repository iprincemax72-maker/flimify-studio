// The visual timeline (Premiere-style): a ruler, one row per track with clip
// blocks, and a playhead synced to the Player. Click anywhere to seek.
import { useRef } from 'react';
import type { EditorState } from './types';

const PX_PER_FRAME = 5;            // timeline zoom (5px = 1 frame @30fps ≈ 150px/s)
const TRACK_H = 46;
const RULER_H = 26;

export const TimelineStrip: React.FC<{
  state: EditorState;
  currentFrame: number;
  onSeek: (frame: number) => void;
}> = ({ state, currentFrame, onSeek }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const totalW = state.durationInFrames * PX_PER_FRAME;

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const frame = Math.max(0, Math.min(state.durationInFrames, Math.round(x / PX_PER_FRAME)));
    onSeek(frame);
  };

  // second ticks on the ruler
  const ticks: number[] = [];
  for (let f = 0; f <= state.durationInFrames; f += state.fps) ticks.push(f);

  return (
    <div className="tl" ref={wrapRef} onMouseDown={seekFromEvent}>
      <div className="tl-inner" style={{ width: totalW }}>
        {/* ruler */}
        <div className="tl-ruler" style={{ height: RULER_H }}>
          {ticks.map((f) => (
            <div key={f} className="tl-tick" style={{ left: f * PX_PER_FRAME }}>
              <span>{Math.round(f / state.fps)}s</span>
            </div>
          ))}
        </div>

        {/* tracks (render top track first so V-higher sits visually on top) */}
        {[...state.tracks].reverse().map((track) => (
          <div className="tl-track" key={track.id} style={{ height: TRACK_H }}>
            <div className="tl-track-label">{track.label}</div>
            {track.clips.map((clip) => (
              <div
                key={clip.id}
                className={'tl-clip ' + clip.kind}
                style={{
                  left: clip.from * PX_PER_FRAME,
                  width: clip.durationInFrames * PX_PER_FRAME,
                }}
                title={clip.name}
              >
                <span>{clip.name}</span>
              </div>
            ))}
          </div>
        ))}

        {/* playhead */}
        <div
          className="tl-playhead"
          style={{ left: currentFrame * PX_PER_FRAME, height: RULER_H + state.tracks.length * TRACK_H }}
        />
      </div>
    </div>
  );
};
