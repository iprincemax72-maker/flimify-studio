// Flimify Studio — the editor shell, fully wired to the studio-bridge:
// import footage, generate AI overlays (no API key), export to mp4. Premiere-
// style 4-pane layout; the timeline IS the Remotion composition that previews
// AND exports.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineComposition } from './editor/Composition';
import { TimelineStrip } from './editor/TimelineStrip';
import { FlimifyPanel } from './panels/FlimifyPanel';
import type { Clip, EditorState, Track } from './editor/types';
import { health, importPath, exportTimeline, caption, toTimelineClip, type BridgeClip } from './api';
import './App.css';

const FPS = 30;
// Dev fallback when not running in Electron (so import is testable in a browser).
const DEV_SAMPLE = '/Users/anshdhakad/All Claude Work/flimify-studio/public/sample.mp4';

const emptyState = (): EditorState => ({
  fps: FPS,
  width: 1920,
  height: 1080,
  durationInFrames: 300,
  tracks: [
    { id: 'v1', label: 'V1', clips: [] },
    { id: 'v2', label: 'V2', clips: [] },
  ],
});

const recomputeDuration = (tracks: Track[]): number => {
  let end = 0;
  for (const t of tracks) for (const c of t.clips) end = Math.max(end, c.from + c.durationInFrames);
  return Math.max(end, 1);
};

const fmt = (frame: number, fps: number) => {
  const t = frame / fps;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(Math.floor(frame % fps)).padStart(2, '0')}`;
};

export default function App() {
  const [state, setState] = useState<EditorState>(emptyState);
  const [bin, setBin] = useState<BridgeClip[]>([]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const playerRef = useRef<PlayerRef>(null);

  // bridge health
  useEffect(() => {
    let alive = true;
    const check = async () => { const ok = await health(); if (alive) setOnline(ok); };
    check();
    const t = setInterval(check, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // sync playhead/readout to the Player
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = playerRef.current;
      if (p) { setFrame(p.getCurrentFrame()); setPlaying(p.isPlaying()); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasClips = useMemo(() => state.tracks.some((t) => t.clips.length), [state]);

  const addClip = (trackId: string, clip: Clip) => {
    setState((s) => {
      const tracks = s.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
  };

  const updateClip = (trackId: string, clipId: string, patch: Partial<Clip>) => {
    setState((s) => {
      const tracks = s.tracks.map((t) =>
        t.id === trackId
          ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? ({ ...c, ...patch } as Clip) : c)) }
          : t,
      );
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setState((s) => {
      const tracks = s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selectedId) }));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
    setSelectedId(null);
  };

  // keyboard: Delete/Backspace removes the selected clip; Space toggles play.
  useEffect(() => {
    const editable = () => /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
    const onKey = (e: KeyboardEvent) => {
      if (editable()) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
      else if (e.key === ' ') { e.preventDefault(); playerRef.current?.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── import footage (shared by the button, menu, and drag-drop) ──
  const importByPath = async (p: string) => {
    setStatus('Importing…');
    try {
      const clip = await importPath(p);
      setBin((b) => [clip, ...b]);
      setState((s) => {
        const v1 = s.tracks.find((t) => t.id === 'v1')!;
        const at = v1.clips.reduce((m, c) => Math.max(m, c.from + c.durationInFrames), 0);
        const tracks = s.tracks.map((t) =>
          t.id === 'v1' ? { ...t, clips: [...t.clips, toTimelineClip(clip, at)] } : t,
        );
        return { ...s, width: clip.width, height: clip.height, tracks, durationInFrames: recomputeDuration(tracks) };
      });
      setStatus('');
    } catch (e) {
      setStatus('Import failed: ' + (e as Error).message);
    }
  };

  const onImport = async () => {
    let p: string | null = null;
    if (window.flimify?.openVideo) p = await window.flimify.openVideo();
    else p = DEV_SAMPLE; // browser dev fallback
    if (p) await importByPath(p);
  };

  // ── drag-and-drop video files anywhere onto the editor ──
  const [dragging, setDragging] = useState(false);
  const isVideo = (f: File) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(isVideo);
    for (const f of files) {
      const p = window.flimify?.getPathForFile?.(f) || (f as unknown as { path?: string }).path;
      if (p) await importByPath(p);
      else setStatus('Drag-drop import needs the desktop app');
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.items || []).some((i) => i.kind === 'file')) {
      e.preventDefault();
      setDragging(true);
    }
  };

  // ── generated overlay → V2 at the playhead ──
  const onGenerated = (b: BridgeClip) => {
    setBin((x) => [b, ...x]);
    addClip('v2', toTimelineClip(b, frame));
  };

  // ── export ──
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    if (!hasClips || exporting) return;
    setExporting(true);
    setStatus('Exporting…');
    try {
      const out = await exportTimeline(state, 'flimify-export');
      setStatus('Exported → ' + out);
      window.flimify?.revealFile?.(out);
    } catch (e) {
      setStatus('Export failed: ' + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // ── auto-captions: transcribe V1 footage → animated caption track on V2 ──
  const [captioning, setCaptioning] = useState(false);
  const onCaption = async () => {
    const v1 = state.tracks.find((t) => t.id === 'v1');
    const clip = v1?.clips.find((c) => c.kind === 'video');
    if (!clip) { setStatus('Import footage first'); return; }
    if (captioning) return;
    setCaptioning(true);
    setStatus('Auto-captioning — transcribing + rendering…');
    try {
      const cap = await caption(clip.id, 'tiktok');
      addClip('v2', toTimelineClip(cap, clip.from));
      setStatus('Captions added to V2');
    } catch (e) {
      setStatus('Captions failed: ' + (e as Error).message);
    } finally {
      setCaptioning(false);
    }
  };

  const seek = (f: number) => playerRef.current?.seekTo(f);

  // native menu (Cmd+I / Cmd+E) → editor actions. Register once; use refs for
  // the latest handlers so the listener isn't re-added every render.
  const importRef = useRef(onImport); importRef.current = onImport;
  const exportRef = useRef(onExport); exportRef.current = onExport;
  useEffect(() => {
    window.flimify?.onMenu?.((action) => {
      if (action === 'import') importRef.current();
      else if (action === 'export') exportRef.current();
    });
  }, []);

  return (
    <div
      className="studio"
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (e.clientX === 0 && e.clientY === 0) setDragging(false); }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" onDragLeave={() => setDragging(false)}>
          <div className="drop-card">Drop video to import</div>
        </div>
      )}
      <header className="topbar">
        <div className="brand"><span className="logo">F</span> Flimify <small>Studio</small></div>
        <div className="topbar-mid">
          <span className={'dot ' + (online ? 'on' : online === false ? 'off' : '')} />
          {online ? 'engine ready' : online === false ? 'engine offline' : 'connecting…'}
          {status && <span className="status"> · {status}</span>}
        </div>
        <div className="topbar-right">
          <button className="btn" onClick={onCaption} disabled={captioning}>
            {captioning ? 'Captioning…' : 'Captions'}
          </button>
          <button className="btn" onClick={onExport} disabled={!hasClips || exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      <div className="work">
        <aside className="panel bin">
          <div className="panel-h">Media</div>
          <div className="bin-list">
            {bin.length === 0 && <div className="bin-empty">No media yet</div>}
            {bin.map((c) => (
              <div className="bin-item" key={c.id}>
                <div className="bin-thumb" />
                <div className="bin-meta"><b>{c.name}</b><span>{c.width}×{c.height}</span></div>
              </div>
            ))}
          </div>
          <button className="bin-import" onClick={onImport}>+ Import video</button>
        </aside>

        <main className="stage">
          <div className="player-wrap">
            {hasClips ? (
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
            ) : (
              <div className="stage-empty">
                <p>Import a video or generate a graphic to begin.</p>
              </div>
            )}
          </div>
          <div className="transport">
            <button className="btn play" onClick={() => playerRef.current?.toggle()} disabled={!hasClips}>{playing ? '❚❚' : '►'}</button>
            <span className="tc">{fmt(frame, state.fps)}</span>
            <span className="tc dim">/ {fmt(state.durationInFrames, state.fps)}</span>
          </div>
        </main>

        <aside className="panel flimify">
          <div className="panel-h">Flimify</div>
          <FlimifyPanel width={state.width} height={state.height} onClip={onGenerated} />
        </aside>
      </div>

      <TimelineStrip
        state={state}
        currentFrame={frame}
        onSeek={seek}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onUpdateClip={updateClip}
      />
    </div>
  );
}
