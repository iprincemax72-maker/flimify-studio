// Flimify Studio — the editor shell, fully wired to the studio-bridge:
// import footage, generate AI overlays (no API key), export to mp4. Premiere-
// style 4-pane layout; the timeline IS the Remotion composition that previews
// AND exports.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { TimelineComposition } from './editor/Composition';
import { TimelineStrip } from './editor/TimelineStrip';
import { FlimifyPanel } from './panels/FlimifyPanel';
import type { Clip, ClipTransform, EditorState, Track, TrackType } from './editor/types';
import { MAX_TRACKS, DEFAULT_TRANSFORM, relabelTracks } from './editor/types';
import { EffectControls } from './panels/EffectControls';
import { health, importPath, uploadVideo, exportTimeline, caption, deleteMedia, toTimelineClip, authStatus, FREE_FEATURES, type BridgeClip, type PlanFeatures } from './api';
import { SettingsPanel } from './panels/SettingsPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { CaptionsModal } from './panels/CaptionsModal';
import { AutoEditModal } from './panels/AutoEditModal';
import { Account } from './panels/Account';
import type { CaptionOptions, AeApplied } from './api';
import { loadSettings, saveSettings, applySettings, aspectDims, ACCENT_PALETTES, SETTINGS_DEFAULTS, type Settings } from './settings';
import { configureParticles } from './particles';
import { loadHistory, saveHistory, entryFromClip, type HistoryEntry, type HistoryKind } from './history';
import { FeedbackHost, toast, confirmDialog, openLightbox } from './ui/feedback';
import './App.css';

const FPS = 30;

// ── resizable panel layout (drag the dividers; persisted) ──
type Layout = { leftW: number; rightW: number; timelineH: number };
const LAYOUT_KEY = 'flimifyStudio.layout';
const DEFAULT_LAYOUT: Layout = { leftW: 380, rightW: 560, timelineH: 340 };
const loadLayout = (): Layout => {
  try { return { ...DEFAULT_LAYOUT, ...(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') as Partial<Layout>) }; }
  catch { return { ...DEFAULT_LAYOUT }; }
};
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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

// Small padlock shown on plan-locked buttons.
const LockBadge = () => (
  <svg className="lock-badge" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

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
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [leftTab, setLeftTab] = useState<'media' | 'fx'>('media');
  const playerRef = useRef<PlayerRef>(null);

  // the selected clip + which track it's on (for Effect Controls)
  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const t of state.tracks) for (const c of t.clips) if (c.id === selectedId) return { clip: c, trackId: t.id };
    return null;
  }, [state, selectedId]);
  // jump to Effect Controls when a clip is selected
  useEffect(() => { if (selectedId) setLeftTab('fx'); }, [selectedId]);
  const updateSelectedTransform = (patch: Partial<ClipTransform>) => {
    if (!selected) return;
    const cur = { ...DEFAULT_TRANSFORM, ...(selected.clip.transform || {}) };
    updateClip(selected.trackId, selected.clip.id, { transform: { ...cur, ...patch } } as Partial<Clip>);
  };
  const updateSelectedAudio = (gainDb: number) => {
    if (!selected) return;
    updateClip(selected.trackId, selected.clip.id, { gainDb } as Partial<Clip>);
  };

  // persist panel sizes
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ } }, [layout]);

  // drag a panel divider. kind: 'left' (Media↔Preview), 'right' (Preview↔Flimify), 'timeline' (Work↔Timeline)
  const onSplitterDown = (e: React.MouseEvent, kind: 'left' | 'right' | 'timeline') => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = layout;
    const move = (ev: MouseEvent) => setLayout((l) => {
      if (kind === 'left') return { ...l, leftW: clampN(start.leftW + (ev.clientX - sx), 240, 720) };
      if (kind === 'right') return { ...l, rightW: clampN(start.rightW - (ev.clientX - sx), 360, 880) };
      return { ...l, timelineH: clampN(start.timelineH - (ev.clientY - sy), 150, 680) };
    });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-col', 'resizing-row');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.classList.add(kind === 'timeline' ? 'resizing-row' : 'resizing-col');
  };
  const resetLayout = () => setLayout({ ...DEFAULT_LAYOUT });

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

  // plan / feature gating — mirrors the Premiere extension (Auto-Edit = Studio,
  // Captions = early-access; free is locked). The bridge is the real backstop;
  // this locks the UI and explains why. Default locked until the bridge answers.
  const [features, setFeatures] = useState<PlanFeatures>(FREE_FEATURES);
  const [siteUrl, setSiteUrl] = useState('https://www.flimify.com');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const s = await authStatus(); if (alive && s) { setFeatures(s.features || FREE_FEATURES); if (s.site) setSiteUrl(s.site); } } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 30000);
    const onFocus = () => load();   // refresh right after an account switch / purchase
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  // Engine switching is owner-only — pin everyone else to Remotion so a stale
  // 'hyperframes' setting can't leak into generation.
  useEffect(() => {
    if (!features.engine && settings.engine !== 'remotion') patchSettings({ engine: 'remotion' });
  }, [features.engine, settings.engine]);
  // auto-update landed (desktop hot-reload) → confirm it visibly
  useEffect(() => { window.flimify?.onUpdated?.(() => toast('Updated to the latest version ✓')); }, []);

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
  // Stable inputProps reference: App re-renders ~60fps during playback (playhead
  // sync), so a fresh `{ state }` object each render would force Remotion to
  // re-render the whole video composition every frame, starving the Player's
  // master clock and making the preview drift + snap back (~2s stutter).
  // Memoizing keeps the composition driven only by the Player's own frame clock.
  const playerInputProps = useMemo(() => ({ state }), [state]);

  const addClip = (trackId: string, clip: Clip) => {
    setState((s) => {
      const tracks = s.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
  };

  const updateClip = (_trackId: string, clipId: string, patch: Partial<Clip>) => {
    setState((s) => {
      // a linked clip mirrors its timeline geometry (from/dur/trim) onto its
      // partner — unless the pair has been unlinked.
      let linkId: string | undefined;
      for (const t of s.tracks) for (const c of t.clips) if (c.id === clipId) { if (!c.unlinked) linkId = c.linkId; }
      const geo = (p: Partial<Clip>): Partial<Clip> => {
        const o: Partial<Clip> = {};
        if (p.from != null) o.from = p.from;
        if (p.durationInFrames != null) o.durationInFrames = p.durationInFrames;
        if ('trimBefore' in p) (o as { trimBefore?: number }).trimBefore = (p as { trimBefore?: number }).trimBefore;
        return o;
      };
      const mirror = linkId && (patch.from != null || patch.durationInFrames != null || 'trimBefore' in patch);
      const tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id === clipId) return { ...c, ...patch } as Clip;
          if (mirror && c.linkId === linkId && !c.unlinked) return { ...c, ...geo(patch) } as Clip;
          return c;
        }),
      }));
      return { ...s, tracks, durationInFrames: recomputeDuration(tracks) };
    });
  };

  // link / unlink a footage video ↔ audio pair (right-click a clip)
  const toggleLink = (clipId: string) => {
    let linkId: string | undefined, cur = false;
    for (const t of state.tracks) for (const c of t.clips) if (c.id === clipId) { linkId = c.linkId; cur = !!c.unlinked; }
    if (!linkId) return;
    const newUnlinked = !cur;
    setState((s) => ({
      ...s,
      tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.linkId === linkId ? ({ ...c, unlinked: newUnlinked } as Clip) : c)) })),
    }));
    toast(newUnlinked ? 'Unlinked video + audio.' : 'Linked video + audio.');
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setState((s) => {
      // also remove a linked partner (footage video ↔ its split audio) unless unlinked
      let linkId: string | undefined;
      for (const t of s.tracks) for (const c of t.clips) if (c.id === selectedId && !c.unlinked) linkId = c.linkId;
      const tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== selectedId && !(linkId && c.linkId === linkId && !c.unlinked)),
      }));
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
  // land a freshly-imported/uploaded clip onto the bin + the base video track,
  // splitting its audio onto a linked clip on A1 (so you can see/move/mute it).
  const landImportedClip = (clip: BridgeClip) => {
    setBin((b) => [clip, ...b]);
    addHistory(clip, 'import');
    setState((s) => {
      const baseV = s.tracks.find((t) => t.type === 'video')!;
      const at = baseV.clips.reduce((m, c) => Math.max(m, c.from + c.durationInFrames), 0);
      const linkId = clip.hasAudio ? 'lnk_' + clip.id : undefined;
      const videoClip: Clip = { ...toTimelineClip(clip, at), muted: !!clip.hasAudio, linkId } as Clip;
      let tracks = s.tracks.map((t) => (t.id === baseV.id ? { ...t, clips: [...t.clips, videoClip] } : t));
      const baseA = s.tracks.find((t) => t.type === 'audio');
      if (clip.hasAudio && baseA) {
        const audioClip: Clip = { id: clip.id + '_a', kind: 'audio', name: clip.name, src: clip.src, from: at, durationInFrames: clip.durationFrames, linkId };
        tracks = tracks.map((t) => (t.id === baseA.id ? { ...t, clips: [...t.clips, audioClip] } : t));
      }
      return { ...s, width: clip.width, height: clip.height, tracks, durationInFrames: recomputeDuration(tracks) };
    });
  };
  const importByPath = async (p: string) => {
    setStatus('Importing…');
    try { landImportedClip(await importPath(p)); setStatus(''); }
    catch (e) { setStatus('Import failed: ' + (e as Error).message); toast('Import failed: ' + (e as Error).message, true); }
  };
  // web mode: upload the File to the bridge (browser has no file path)
  const importByUpload = async (file: File) => {
    setStatus('Uploading…');
    try { landImportedClip(await uploadVideo(file)); setStatus(''); toast('Imported “' + file.name + '”.'); }
    catch (e) { setStatus('Upload failed: ' + (e as Error).message); toast('Upload failed: ' + (e as Error).message, true); }
  };

  // hidden <input> drives import in the browser (no native dialog)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onImport = async () => {
    if (window.flimify?.openVideo) {
      const p = await window.flimify.openVideo();
      if (p) await importByPath(p);
    } else {
      fileInputRef.current?.click(); // web / browser
    }
  };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) await importByUpload(f);
    e.target.value = '';
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
      if (p) await importByPath(p);    // desktop — fast, no copy
      else await importByUpload(f);     // web — upload the bytes
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

  // ── captions studio: transcribe footage → animated caption track ──
  const [captioning, setCaptioning] = useState(false);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const openCaptions = () => {
    const clip = state.tracks.filter((t) => t.type === 'video').flatMap((t) => t.clips).find((c) => c.kind === 'video');
    if (!clip) { toast('Import footage first to caption it.', true); return; }
    setCaptionsOpen(true);
  };
  // ── Auto-Edit: read footage speech → plan + render graphics → place at their
  // timeline moments on overlay tracks ──
  const [autoEditOpen, setAutoEditOpen] = useState(false);
  const footageClip = () => state.tracks.filter((t) => t.type === 'video').flatMap((t) => t.clips).find((c) => c.kind === 'video');
  const openAutoEdit = () => {
    if (!footageClip()) { toast('Import footage first — Auto-Edit reads its speech.', true); return; }
    setAutoEditOpen(true);
  };
  // Locked-feature prompt (free tier). Mirrors the extension's upsell.
  const featureUpsell = async (feature: 'autoedit' | 'captions') => {
    const copy = feature === 'autoedit'
      ? { title: 'Auto-Edit is a Studio feature', message: 'Auto-Edit reads your footage, finds the key moments, and drops matching motion graphics across the whole clip. Upgrade to Studio to unlock it.' }
      : { title: 'Captions are a Studio feature', message: 'Auto-captions transcribe your footage and add animated caption tracks. Upgrade to Studio to unlock them.' };
    const ok = await confirmDialog({ ...copy, okLabel: 'See plans ↗', cancelLabel: 'Maybe later' });
    if (ok) { try { window.open((siteUrl || 'https://www.flimify.com') + '/#pricing', '_blank', 'noopener'); } catch { /* ignore */ } }
  };
  const applyAutoEdit = (applied: AeApplied[], clipFrom: number) => {
    for (const a of applied) {
      const clip: BridgeClip = a.clip;
      setBin((x) => [clip, ...x]);
      addHistory(clip, 'generate', a.label);
      const at = clipFrom + Math.round(a.atSec * state.fps);
      addClip(overlayTrackId(), toTimelineClip(clip, at));
    }
  };

  const runCaptions = async (style: string, wordsPerLine: number, options: CaptionOptions) => {
    const clip = state.tracks.filter((t) => t.type === 'video').flatMap((t) => t.clips).find((c) => c.kind === 'video');
    if (!clip) { toast('Import footage first.', true); setCaptionsOpen(false); return; }
    setCaptioning(true);
    try {
      const cap = await caption(clip.id, style, wordsPerLine, options);
      addHistory(cap, 'caption');
      addClip(overlayTrackId(), toTimelineClip(cap, clip.from));
      toast('Captions added to ' + overlayLabel() + '.');
      setCaptionsOpen(false);
    } catch (e) {
      toast('Captions failed: ' + (e as Error).message, true);
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
      style={{ gridTemplateRows: `44px minmax(0,1fr) 6px ${layout.timelineH}px` }}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (e.clientX === 0 && e.clientY === 0) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="aurora" aria-hidden />
      <canvas id="particleCanvas" aria-hidden />
      <input ref={fileInputRef} type="file" accept="video/*" multiple hidden onChange={onFilePicked} />
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
        <div
          className={'topbar-mid' + (online === false ? ' clickable' : '')}
          onClick={() => { if (online === false) { window.flimify?.restartEngine?.(); setStatus('Restarting engine…'); setTimeout(() => setStatus(''), 3000); } }}
          title={online === false ? 'Click to restart the engine' : undefined}
        >
          <span className={'dot ' + (online ? 'on' : online === false ? 'off' : '')} />
          {online ? 'engine ready' : online === false ? 'engine offline · restart' : 'connecting…'}
          {status && <span className="status"> · {status}</span>}
        </div>
        <div className="topbar-right">
          <button className="btn icon" onClick={() => setHistoryOpen(true)} title="History" aria-label="History">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
          </button>
          <Account />
          <button className="btn icon" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button
            className={'btn' + (features.autoedit ? '' : ' plan-locked')}
            onClick={() => (features.autoedit ? openAutoEdit() : featureUpsell('autoedit'))}
            title={features.autoedit ? undefined : 'Studio feature'}
          >
            Auto-Edit{!features.autoedit && <LockBadge />}
          </button>
          <button
            className={'btn' + (features.captions ? '' : ' plan-locked')}
            onClick={() => (features.captions ? openCaptions() : featureUpsell('captions'))}
            disabled={features.captions && captioning}
            title={features.captions ? undefined : 'Studio feature'}
          >
            {captioning && features.captions ? 'Captioning…' : 'Captions'}{!features.captions && <LockBadge />}
          </button>
          <button className="btn" onClick={onExport} disabled={!hasClips || exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      <div className="work" style={{ gridTemplateColumns: `${layout.leftW}px 6px minmax(0,1fr) 6px ${layout.rightW}px` }}>
        <aside className="panel bin">
          <div className="panel-h panel-tabs">
            <button className={leftTab === 'media' ? 'on' : ''} onClick={() => setLeftTab('media')}>Media</button>
            <button className={leftTab === 'fx' ? 'on' : ''} onClick={() => setLeftTab('fx')}>Effect Controls</button>
          </div>
          {leftTab === 'media' ? (
            <>
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
            </>
          ) : (
            <div className="fx-scroll">
              <EffectControls clip={selected?.clip ?? null} onChange={updateSelectedTransform} onAudio={updateSelectedAudio} />
            </div>
          )}
        </aside>

        <div className="splitter-v" onMouseDown={(e) => onSplitterDown(e, 'left')} onDoubleClick={resetLayout} title="Drag to resize · double-click to reset" />

        <main className="stage">
          <div className="player-wrap">
            {hasClips ? (
              <Player
                ref={playerRef}
                component={TimelineComposition}
                inputProps={playerInputProps}
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

        <div className="splitter-v" onMouseDown={(e) => onSplitterDown(e, 'right')} onDoubleClick={resetLayout} title="Drag to resize · double-click to reset" />

        <aside className="panel flimify">
          <div className="panel-h">Flimify</div>
          <FlimifyPanel
            width={aspectDims(settings.aspect, state.width, state.height)[0]}
            height={aspectDims(settings.aspect, state.width, state.height)[1]}
            durationSec={settings.duration === 'auto' ? 4 : Number(settings.duration)}
            defaultEngine="remotion"
            inject={inject}
            onRender={onRenderLogged}
            onImport={onImportClip}
            onPreview={onPreviewClip}
            onDelete={onDeleteClip}
          />
        </aside>
      </div>

      <div className="splitter-h" onMouseDown={(e) => onSplitterDown(e, 'timeline')} onDoubleClick={resetLayout} title="Drag to resize the timeline · double-click to reset" />

      <TimelineStrip
        state={state}
        currentFrame={frame}
        onSeek={seek}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onUpdateClip={updateClip}
        onAddTrack={addTrack}
        onDeleteTrack={deleteTrack}
        onToggleLink={toggleLink}
      />

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={patchSettings}
          onClose={() => setSettingsOpen(false)}
          onClearHistory={() => { saveHistory([]); setHistory([]); }}
          onReset={() => setSettings({ ...SETTINGS_DEFAULTS })}
          features={features}
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
      {captionsOpen && (
        <CaptionsModal onClose={() => setCaptionsOpen(false)} onGenerate={runCaptions} busy={captioning} />
      )}
      {autoEditOpen && footageClip() && (
        <AutoEditModal
          clipId={footageClip()!.id}
          clipFrom={footageClip()!.from}
          engine={settings.engine}
          onClose={() => setAutoEditOpen(false)}
          onApply={applyAutoEdit}
        />
      )}
      <FeedbackHost />
    </div>
  );
}
