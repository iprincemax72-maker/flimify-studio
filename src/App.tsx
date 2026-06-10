// Flimify Studio — the editor shell, fully wired to the studio-bridge:
// import footage, generate AI overlays (no API key), export to mp4. Premiere-
// style 4-pane layout; the timeline IS the Remotion composition that previews
// AND exports.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineComposition } from './editor/Composition';
import { TimelineStrip } from './editor/TimelineStrip';
import { FlimifyPanel } from './panels/FlimifyPanel';
import type { Clip, EditorState, Track, TrackType } from './editor/types';
import { MAX_TRACKS, relabelTracks } from './editor/types';
import { health, importPath, exportTimeline, caption, deleteMedia, toTimelineClip, type BridgeClip } from './api';
import { SettingsPanel } from './panels/SettingsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { loadSettings, saveSettings, applySettings, aspectDims, ACCENT_PALETTES, SETTINGS_DEFAULTS, type Settings } from './settings';
import { configureParticles } from './particles';
import { loadHistory, saveHistory, entryFromClip, type HistoryEntry, type HistoryKind } from './history';
import { FeedbackHost, toast, confirmDialog, openLightbox } from './ui/feedback';
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
    { id: 'v1', type: 'video', label: 'V1', clips: [] },
    { id: 'v2', type: 'video', label: 'V2', clips: [] },
    { id: 'a1', type: 'audio', label: 'A1', clips: [] },
    { id: 'a2', type: 'audio', label: 'A2', clips: [] },
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
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inject, setInject] = useState<{ text: string; id: number } | null>(null);
  const playerRef = useRef<PlayerRef>(null);

  const addHistory = (clip: BridgeClip, kind: HistoryKind, prompt?: string) => {
    setHistory((h) => {
      const next = [entryFromClip(clip, kind, prompt), ...h.filter((e) => e.id !== clip.id)];
      saveHistory(next);
      return next;
    });
  };

  // apply + persist appearance/defaults live (incl. accent-tinted particles)
  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
    const rgb = (ACCENT_PALETTES[settings.accent] || ACCENT_PALETTES.coral).rgb;
    configureParticles(settings.particles, rgb);
  }, [settings]);
  const patchSettings = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  // boot-intro splash (once per launch, respecting the setting)
  const [booting, setBooting] = useState(() => loadSettings().bootIntro);
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(t);
  }, [booting]);

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
      addHistory(clip, 'import');
      setState((s) => {
        const base = s.tracks.find((t) => t.type === 'video')!;
        const at = base.clips.reduce((m, c) => Math.max(m, c.from + c.durationInFrames), 0);
        const tracks = s.tracks.map((t) =>
          t.id === base.id ? { ...t, clips: [...t.clips, toTimelineClip(clip, at)] } : t,
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

  // overlay graphics + captions go on the TOP video track (so they sit above
  // the footage); falls back to the only video track if there's just one.
  const overlayTrackId = () => {
    const vids = state.tracks.filter((t) => t.type === 'video');
    return (vids[vids.length - 1] || vids[0])?.id || 'v2';
  };

  const overlayLabel = () => {
    const vids = state.tracks.filter((t) => t.type === 'video');
    return (vids[vids.length - 1] || vids[0])?.label || 'V2';
  };

  // ── a generation finished → log it (bin + history); does NOT auto-place.
  // The render card in the Flimify panel offers Import-to-Timeline, like the
  // extension. ──
  const onRenderLogged = (b: BridgeClip, prompt?: string) => {
    setBin((x) => [b, ...x]);
    addHistory(b, 'generate', prompt || b.name.replace(/^AI · /, ''));
  };
  // ── render card → "Import to Timeline": drop onto the overlay track at the
  // playhead (confirm first if the setting is on). ──
  const onImportClip = async (b: BridgeClip) => {
    if (settings.confirmImport) {
      const ok = await confirmDialog({ title: 'Import to timeline?', message: 'Place “' + b.name + '” on ' + overlayLabel() + ' at the playhead.', okLabel: 'Import' });
      if (!ok) return;
    }
    addClip(overlayTrackId(), toTimelineClip(b, frame));
    toast('Imported “' + b.name + '” → ' + overlayLabel());
  };
  const onPreviewClip = (b: BridgeClip) => openLightbox({ src: b.src, kind: 'video', caption: b.name });
  const onDeleteClip = async (b: BridgeClip): Promise<boolean> => {
    const ok = await confirmDialog({ title: 'Delete this render?', message: 'Removes “' + b.name + '” from disk. This can’t be undone.', okLabel: 'Delete', danger: true });
    if (!ok) return false;
    try { await deleteMedia(b.id); } catch { /* still drop from UI */ }
    setBin((x) => x.filter((c) => c.id !== b.id));
    setHistory((h) => { const n = h.filter((e) => e.id !== b.id); saveHistory(n); return n; });
    setState((s) => {
      const tracks = s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !('src' in c) || c.src !== b.src) }));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
    toast('Deleted “' + b.name + '”.');
    return true;
  };

  // ── add / remove timeline tracks (right-click on a track header) ──
  const addTrack = (type: TrackType) => {
    setState((s) => {
      if (s.tracks.length >= MAX_TRACKS) return s;
      const newTrack: Track = { id: type[0] + Date.now().toString(36), type, label: '', clips: [] };
      const vids = s.tracks.filter((t) => t.type === 'video');
      const auds = s.tracks.filter((t) => t.type === 'audio');
      const tracks = relabelTracks(
        type === 'video' ? [...vids, newTrack, ...auds] : [...vids, ...auds, newTrack],
      );
      return { ...s, tracks };
    });
  };
  const deleteTrack = (id: string) => {
    setState((s) => {
      if (s.tracks.length <= 1) return s;
      const tracks = relabelTracks(s.tracks.filter((t) => t.id !== id));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
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
      toast('Exported → ' + out.split('/').pop());
      window.flimify?.revealFile?.(out);
    } catch (e) {
      setStatus('Export failed: ' + (e as Error).message);
      toast('Export failed: ' + (e as Error).message, true);
    } finally {
      setExporting(false);
    }
  };

  // ── auto-captions: transcribe V1 footage → animated caption track on V2 ──
  const [captioning, setCaptioning] = useState(false);
  const onCaption = async () => {
    const clip = state.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .find((c) => c.kind === 'video');
    if (!clip) { setStatus('Import footage first'); return; }
    if (captioning) return;
    setCaptioning(true);
    setStatus('Auto-captioning — transcribing + rendering…');
    try {
      const cap = await caption(clip.id, 'tiktok');
      addHistory(cap, 'caption');
      addClip(overlayTrackId(), toTimelineClip(cap, clip.from));
      setStatus('Captions added to V2');
    } catch (e) {
      setStatus('Captions failed: ' + (e as Error).message);
    } finally {
      setCaptioning(false);
    }
  };

  // ── History: re-add a past render, or delete it from disk + history ──
  const onHistoryAdd = (e: HistoryEntry) => {
    const clip: BridgeClip = {
      id: e.id, kind: 'video', name: e.name, src: e.src,
      width: e.width, height: e.height, fps: e.fps, durationFrames: e.durationFrames, hasAlpha: false,
    };
    const trackId = e.kind === 'import' ? (state.tracks.find((t) => t.type === 'video')?.id || 'v1') : overlayTrackId();
    addClip(trackId, toTimelineClip(clip, e.kind === 'import' ? 0 : frame));
  };
  const onHistoryDelete = async (e: HistoryEntry) => {
    const ok = await confirmDialog({
      title: 'Delete this render?',
      message: 'Removes “' + e.name + '” from disk and from history. This can’t be undone.',
      okLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    try { await deleteMedia(e.id); } catch { /* ignore — still drop from UI */ }
    setHistory((h) => { const n = h.filter((x) => x.id !== e.id); saveHistory(n); return n; });
    setBin((b) => b.filter((c) => c.id !== e.id));
    setState((s) => {
      const tracks = s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !('src' in c) || c.src !== e.src) }));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
    toast('Deleted “' + e.name + '”.');
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
      <div className="aurora" aria-hidden />
      <canvas id="particleCanvas" aria-hidden />
      {booting && (
        <div className="boot-intro" onClick={() => setBooting(false)}>
          <div className="boot-mark">F</div>
          <div className="boot-word">Flimify <span>Studio</span></div>
        </div>
      )}
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
          <button className="btn icon" onClick={() => setHistoryOpen(true)} title="History" aria-label="History">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
          </button>
          <button className="btn icon" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
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
          <FlimifyPanel
            width={aspectDims(settings.aspect, state.width, state.height)[0]}
            height={aspectDims(settings.aspect, state.width, state.height)[1]}
            durationSec={settings.duration === 'auto' ? 4 : Number(settings.duration)}
            defaultEngine={settings.engine}
            inject={inject}
            onRender={onRenderLogged}
            onImport={onImportClip}
            onPreview={onPreviewClip}
            onDelete={onDeleteClip}
          />
        </aside>
      </div>

      <TimelineStrip
        state={state}
        currentFrame={frame}
        onSeek={seek}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onUpdateClip={updateClip}
        onAddTrack={addTrack}
        onDeleteTrack={deleteTrack}
      />

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={patchSettings}
          onClose={() => setSettingsOpen(false)}
          onClearHistory={() => { saveHistory([]); setHistory([]); }}
          onReset={() => setSettings({ ...SETTINGS_DEFAULTS })}
        />
      )}
      {historyOpen && (
        <HistoryPanel
          history={history}
          onClose={() => setHistoryOpen(false)}
          onAdd={onHistoryAdd}
          onDelete={onHistoryDelete}
          onUsePrompt={(text) => { setInject({ text, id: frame + Math.floor(performance.now()) }); setHistoryOpen(false); }}
        />
      )}
      <FeedbackHost />
    </div>
  );
}
