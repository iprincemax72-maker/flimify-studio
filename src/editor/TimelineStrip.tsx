// Interactive timeline (Premiere-style): ruler, video tracks (V-higher on top),
// a divider, then audio tracks (A1, A2…), clip blocks, and a playhead synced to
// the Player. Click empty space to seek; click a clip to select; drag body to
// move; edge-drag to trim. RIGHT-CLICK a track header → add/remove tracks.
//
// ZOOM: hold **Alt** and scroll the wheel over the timeline to zoom in/out
// (anchored at the cursor) — or use the −/Fit/+ buttons. "Fit" scales the whole
// video to the visible width, so a long clip is never cut off past the edge.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Clip, EditorState, Track, TrackType } from './types';
import { MAX_TRACKS } from './types';

const DEFAULT_PX_PER_FRAME = 5;
const MIN_PX_PER_FRAME = 0.02; // zoomed all the way out (fits very long videos)
const MAX_PX_PER_FRAME = 40;   // zoomed all the way in (frame-accurate)
const TRACK_H = 40;
const RULER_H = 26;
const EDGE = 9;
const LABEL_W = 34; // left gutter for the V1/V2/A1… track headers (matches CSS)

const clampPx = (px: number) => Math.max(MIN_PX_PER_FRAME, Math.min(MAX_PX_PER_FRAME, px));
// ruler label: "8s" under a minute, "1:30" above
const fmtSec = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
// candidate seconds-per-tick so labels never crowd (>= ~64px apart)
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];

type Patch = Partial<Pick<Clip, 'from' | 'durationInFrames'>> & { trimBefore?: number };

type Drag = {
  trackId: string; clipId: string; mode: 'move' | 'trim-left' | 'trim-right';
  startX: number; startFrom: number; startDur: number; startTrim: number | null;
};

type Menu = { x: number; y: number; trackId?: string; clip?: Clip } | null;

export const TimelineStrip: React.FC<{
  state: EditorState;
  currentFrame: number;
  onSeek: (frame: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateClip: (trackId: string, clipId: string, patch: Patch) => void;
  onAddTrack: (type: TrackType) => void;
  onDeleteTrack: (trackId: string) => void;
  onToggleLink: (clipId: string) => void;
  onDropMedia?: (trackId: string, frame: number) => void;
}> = ({ state, currentFrame, onSeek, selectedId, onSelect, onUpdateClip, onAddTrack, onDeleteTrack, onToggleLink, onDropMedia }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<Menu>(null);

  // zoom level (px per frame). pxRef mirrors it so the long-lived mousemove /
  // wheel / seek handlers always read the *current* zoom without re-subscribing.
  const [pxPerFrame, setPxPerFrame] = useState(DEFAULT_PX_PER_FRAME);
  const pxRef = useRef(pxPerFrame);
  pxRef.current = pxPerFrame;
  // after a zoom we re-anchor scrollLeft so the frame under the cursor stays put
  const pendingAnchor = useRef<{ frame: number; clientX: number } | null>(null);

  const totalW = state.durationInFrames * pxPerFrame;

  // ordered for display: video tracks with the highest V on top, then audio
  const videoTracks = state.tracks.filter((t) => t.type === 'video');
  const audioTracks = state.tracks.filter((t) => t.type === 'audio');
  const ordered: Track[] = [...videoTracks].reverse().concat(audioTracks);

  // ── zoom helpers ──
  const zoomAroundClientX = (nextPx: number, clientX: number) => {
    const el = wrapRef.current;
    const px = pxRef.current;
    if (el && px > 0) {
      const rect = el.getBoundingClientRect();
      const frame = (clientX - rect.left + el.scrollLeft - LABEL_W) / px;
      pendingAnchor.current = { frame, clientX };
    }
    const np = clampPx(nextPx);
    pxRef.current = np;           // sync now so back-to-back wheel ticks accumulate
    setPxPerFrame(np);
  };
  const zoomAtCenter = (nextPx: number) => {
    const el = wrapRef.current;
    if (!el) { setPxPerFrame(clampPx(nextPx)); return; }
    const rect = el.getBoundingClientRect();
    zoomAroundClientX(nextPx, rect.left + el.clientWidth / 2);
  };
  const fitAll = () => {
    const el = wrapRef.current;
    if (!el || state.durationInFrames <= 0) return;
    const avail = el.clientWidth - LABEL_W - 24;
    pendingAnchor.current = null;
    setPxPerFrame(clampPx(avail / state.durationInFrames));
    requestAnimationFrame(() => { if (wrapRef.current) wrapRef.current.scrollLeft = 0; });
  };

  // re-anchor scrollLeft after the zoom re-renders, keeping the cursor frame fixed
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const el = wrapRef.current;
    if (a && el) {
      const rect = el.getBoundingClientRect();
      el.scrollLeft = a.frame * pxPerFrame + LABEL_W - (a.clientX - rect.left);
      pendingAnchor.current = null;
    }
  }, [pxPerFrame]);

  // Wheel over the timeline (native non-passive so we can preventDefault):
  //   • Alt + wheel  → zoom in/out, anchored at the cursor
  //   • Shift + wheel → pan horizontally like Premiere (scroll up = left, down = right)
  //   • plain wheel   → default (vertical track scroll)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAroundClientX(pxRef.current * factor, e.clientX);
        return;
      }
      if (e.shiftKey) {
        // some browsers already remap shift+wheel onto deltaX — take whichever axis moved
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (delta !== 0) {
          // ALWAYS consume it: at the scroll boundary (e.g. zoomed out, nothing to
          // pan) an un-consumed shift+wheel triggers the browser's horizontal
          // overscroll → back/forward swipe, which blanks/reloads the app.
          e.preventDefault();
          if (el.scrollWidth > el.clientWidth) el.scrollLeft += delta; // up (−) → left, down (+) → right
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxFrames = Math.round((e.clientX - d.startX) / pxRef.current);
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

  // close the context menu on any outside click
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close); };
  }, [menu]);

  // Grab anywhere on the timeline/ruler to move the playhead, and keep dragging
  // to scrub — like Premiere. (Clicking a clip selects it; clicking a label is
  // handled separately — both stopPropagation.)
  const seekFromEvent = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    onSelect(null);
    const seekAt = (clientX: number) => {
      const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W;
      onSeek(Math.max(0, Math.min(state.durationInFrames, Math.round(x / pxRef.current))));
    };
    seekAt(e.clientX);
    const move = (ev: MouseEvent) => seekAt(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('scrubbing-ph'); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.classList.add('scrubbing-ph');
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
      startTrim: (clip.kind === 'video' || clip.kind === 'audio') ? (clip.trimBefore || 0) : null,
    };
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';
  };

  const onHeaderMenu = (e: React.MouseEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, trackId });
  };
  const onClipMenu = (e: React.MouseEvent, trackId: string, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(clip.id);
    setMenu({ x: e.clientX, y: e.clientY, trackId, clip });
  };

  // adaptive ruler — pick a tick spacing that keeps labels from crowding at any zoom
  const pxPerSec = pxPerFrame * state.fps;
  const secStep = TICK_STEPS.find((s) => s * pxPerSec >= 64) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const frameStep = Math.max(1, secStep * state.fps);
  const ticks: number[] = [];
  for (let f = 0; f <= state.durationInFrames; f += frameStep) ticks.push(f);
  const atMax = state.tracks.length >= MAX_TRACKS;

  return (
    <div className="tl-wrap">
      <div className="tl-zoom" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button title="Zoom out (Alt + scroll)" onClick={() => zoomAtCenter(pxRef.current / 1.4)}>−</button>
        <button className="tl-zoom-fit" title="Fit the whole video in view" onClick={fitAll}>Fit</button>
        <button title="Zoom in (Alt + scroll)" onClick={() => zoomAtCenter(pxRef.current * 1.4)}>+</button>
      </div>

      <div className="tl" ref={wrapRef} onMouseDown={seekFromEvent}>
        <div className="tl-inner" style={{ width: LABEL_W + totalW }}>
          <div className="tl-ruler" style={{ height: RULER_H }}>
            {ticks.map((f) => (
              <div key={f} className="tl-tick" style={{ left: LABEL_W + f * pxPerFrame }}>
                <span>{fmtSec(Math.round(f / state.fps))}</span>
              </div>
            ))}
          </div>

          {ordered.map((track, i) => {
            const prev = ordered[i - 1];
            const divider = prev && prev.type === 'video' && track.type === 'audio';
            return (
              <div
                className={'tl-track ' + track.type + (divider ? ' tl-divider' : '') + (dropTrack === track.id ? ' drop-target' : '')}
                key={track.id}
                style={{ height: TRACK_H }}
                onDragOver={onDropMedia ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dropTrack !== track.id) setDropTrack(track.id); } : undefined}
                onDragLeave={onDropMedia ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTrack((d) => (d === track.id ? null : d)); } : undefined}
                onDrop={onDropMedia ? (e) => {
                  e.preventDefault(); e.stopPropagation();
                  const el = wrapRef.current;
                  if (el) {
                    const rect = el.getBoundingClientRect();
                    const x = e.clientX - rect.left + el.scrollLeft - LABEL_W;
                    onDropMedia(track.id, Math.max(0, Math.round(x / pxRef.current)));
                  }
                  setDropTrack(null);
                } : undefined}
              >
                <div
                  className="tl-track-label"
                  onMouseDown={(e) => e.stopPropagation()}
                  onContextMenu={(e) => onHeaderMenu(e, track.id)}
                  title="Right-click to add or remove tracks"
                >
                  {track.label}
                </div>
                {track.clips.map((clip) => (
                  <div
                    key={clip.id}
                    className={'tl-clip ' + clip.kind + (selectedId === clip.id ? ' sel' : '') + (clip.linkId && !clip.unlinked ? ' linked' : '')}
                    style={{ left: LABEL_W + clip.from * pxPerFrame, width: clip.durationInFrames * pxPerFrame }}
                    title={clip.name}
                    onMouseDown={(e) => onClipDown(e, track.id, clip)}
                    onContextMenu={(e) => onClipMenu(e, track.id, clip)}
                  >
                    {clip.linkId && !clip.unlinked && <span className="tl-link" title="Linked">🔗</span>}
                    <span>{clip.name}</span>
                  </div>
                ))}
              </div>
            );
          })}

          <div
            className="tl-playhead"
            style={{ left: LABEL_W + currentFrame * pxPerFrame, height: RULER_H + ordered.length * TRACK_H }}
          />
        </div>
      </div>

      {menu && (
        <div className="tl-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.clip ? (
            menu.clip.linkId ? (
              <button onClick={() => { onToggleLink(menu.clip!.id); setMenu(null); }}>
                {menu.clip.unlinked ? '🔗 Link video + audio' : '⛓ Unlink video + audio'}
              </button>
            ) : (
              <div className="tl-menu-note">This clip has no linked audio/video</div>
            )
          ) : (
            <>
              <button disabled={atMax} onClick={() => { onAddTrack('video'); setMenu(null); }}>Add video track</button>
              <button disabled={atMax} onClick={() => { onAddTrack('audio'); setMenu(null); }}>Add audio track</button>
              <button className="danger" disabled={state.tracks.length <= 1} onClick={() => { onDeleteTrack(menu.trackId!); setMenu(null); }}>Delete this track</button>
              {atMax && <div className="tl-menu-note">Max {MAX_TRACKS} tracks</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};
