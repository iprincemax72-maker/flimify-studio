// Flimify Studio — the standalone editor shell. Premiere-style 4-pane layout:
// media bin · live preview (Remotion Player) · Flimify AI panel · timeline.
// The skeleton proves the thesis: footage + an AI overlay composited live in
// the SAME Remotion composition that will export to mp4.
import { useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineComposition } from './editor/Composition';
import { TimelineStrip } from './editor/TimelineStrip';
import type { EditorState } from './editor/types';
import './App.css';

const FPS = 30;

// Sample project: real footage on V1, two AI-style overlays on V2.
const initialState: EditorState = {
  fps: FPS,
  width: 1920,
  height: 1080,
  durationInFrames: 240, // 8s
  tracks: [
    {
      id: 'v1',
      label: 'V1',
      clips: [
        { id: 'c1', kind: 'video', src: '/sample.mp4', from: 0, durationInFrames: 240, name: 'sample.mp4' },
      ],
    },
    {
      id: 'v2',
      label: 'V2',
      clips: [
        { id: 'o1', kind: 'title', text: 'Built with Flimify', color: '#ffffff', from: 30, durationInFrames: 110, name: 'Title · Built with Flimify' },
        { id: 'o2', kind: 'title', text: 'No Premiere needed', color: '#E2885F', from: 150, durationInFrames: 80, name: 'Title · No Premiere needed' },
      ],
    },
  ],
};

const fmt = (frame: number, fps: number) => {
  const t = frame / fps;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ff = Math.floor(frame % fps);
  return `${m}:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};

export default function App() {
  const [state] = useState<EditorState>(initialState);
  const playerRef = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Keep the playhead + readout synced to the Player every animation frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = playerRef.current;
      if (p) {
        setFrame(p.getCurrentFrame());
        setPlaying(p.isPlaying());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = (f: number) => playerRef.current?.seekTo(f);
  const toggle = () => playerRef.current?.toggle();

  return (
    <div className="studio">
      {/* ── top bar ── */}
      <header className="topbar">
        <div className="brand"><span className="logo">F</span> Flimify <small>Studio</small></div>
        <div className="topbar-mid">sample-project</div>
        <div className="topbar-right">
          <button className="btn ghost" disabled title="Coming next">Export</button>
        </div>
      </header>

      {/* ── 3-column work area ── */}
      <div className="work">
        {/* media bin */}
        <aside className="panel bin">
          <div className="panel-h">Media</div>
          <div className="bin-item">
            <div className="bin-thumb" />
            <div className="bin-meta"><b>sample.mp4</b><span>1920×1080 · 8s</span></div>
          </div>
          <button className="bin-import" disabled>+ Import (coming)</button>
        </aside>

        {/* preview */}
        <main className="stage">
          <div className="player-wrap">
            <Player
              ref={playerRef}
              component={TimelineComposition}
              inputProps={{ state }}
              durationInFrames={state.durationInFrames}
              fps={state.fps}
              compositionWidth={state.width}
              compositionHeight={state.height}
              style={{ width: '100%', height: '100%' }}
              acknowledgeRemotionLicense
            />
          </div>
          <div className="transport">
            <button className="btn play" onClick={toggle}>{playing ? '❚❚' : '►'}</button>
            <span className="tc">{fmt(frame, state.fps)}</span>
            <span className="tc dim">/ {fmt(state.durationInFrames, state.fps)}</span>
          </div>
        </main>

        {/* Flimify AI panel (docks the real chat/auto-edit/captions UI next) */}
        <aside className="panel flimify">
          <div className="panel-h">Flimify</div>
          <div className="flimify-stub">
            <p>Chat · Auto-Edit · Captions</p>
            <p className="dim">The existing panel docks here and drops generated graphics straight onto the timeline.</p>
          </div>
        </aside>
      </div>

      {/* ── timeline ── */}
      <TimelineStrip state={state} currentFrame={frame} onSeek={seek} />
    </div>
  );
}
