// The editor's single source of truth. The timeline IS a Remotion composition:
// this state is passed to <Player> as inputProps for live preview, and the
// SAME state renders to mp4 on export. Video tracks stack bottom→top (V1 base,
// higher V on top); audio tracks (A1, A2…) sit below. Each clip is a <Sequence>.

/** Effect-controls transform applied to a visual clip (pro-editor-style). */
export type ClipTransform = {
  x: number;        // position offset from centre, in composition px
  y: number;
  scale: number;    // percent (100 = original)
  rotation: number; // degrees
  opacity: number;  // percent (100 = opaque)
};
export const DEFAULT_TRANSFORM: ClipTransform = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 };

/** Per-clip colour grade + creative look, applied to visual clips as a CSS filter. */
export type ClipFilters = {
  brightness: number; // %  (100 = unchanged)
  contrast: number;   // %
  saturate: number;   // %
  blur: number;       // px
  hue: number;        // deg
  sepia: number;      // %
  grayscale: number;  // %
};
export const DEFAULT_FILTERS: ClipFilters = { brightness: 100, contrast: 100, saturate: 100, blur: 0, hue: 0, sepia: 0, grayscale: 0 };

/** Build a CSS `filter` string from a (partial) ClipFilters; '' when neutral. */
export function filtersToCss(f?: Partial<ClipFilters>): string {
  if (!f) return '';
  const v = { ...DEFAULT_FILTERS, ...f };
  const p: string[] = [];
  if (v.brightness !== 100) p.push(`brightness(${v.brightness}%)`);
  if (v.contrast !== 100) p.push(`contrast(${v.contrast}%)`);
  if (v.saturate !== 100) p.push(`saturate(${v.saturate}%)`);
  if (v.blur > 0) p.push(`blur(${v.blur}px)`);
  if (v.hue !== 0) p.push(`hue-rotate(${v.hue}deg)`);
  if (v.sepia > 0) p.push(`sepia(${v.sepia}%)`);
  if (v.grayscale > 0) p.push(`grayscale(${v.grayscale}%)`);
  return p.join(' ');
}

/** One-tap creative looks → filter presets. */
export type LookName = 'None' | 'B&W' | 'Vivid' | 'Warm' | 'Cool' | 'Vintage' | 'Faded' | 'Noir' | 'Dreamy';
export const LOOKS: Record<LookName, ClipFilters> = {
  'None':    DEFAULT_FILTERS,
  'B&W':     { ...DEFAULT_FILTERS, grayscale: 100, contrast: 110 },
  'Vivid':   { ...DEFAULT_FILTERS, saturate: 165, contrast: 115, brightness: 103 },
  'Warm':    { ...DEFAULT_FILTERS, sepia: 30, saturate: 120, hue: -8, brightness: 104 },
  'Cool':    { ...DEFAULT_FILTERS, hue: 16, saturate: 112, contrast: 106 },
  'Vintage': { ...DEFAULT_FILTERS, sepia: 45, contrast: 94, brightness: 106, saturate: 82 },
  'Faded':   { ...DEFAULT_FILTERS, contrast: 80, saturate: 78, brightness: 112 },
  'Noir':    { ...DEFAULT_FILTERS, grayscale: 100, contrast: 150, brightness: 95 },
  'Dreamy':  { ...DEFAULT_FILTERS, blur: 1.4, brightness: 108, saturate: 122, contrast: 94 },
};

/** CSS mix-blend-mode for a visual clip over the layers beneath it. */
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten' | 'darken' | 'color-dodge' | 'soft-light' | 'difference' | 'hard-light';
export const BLEND_MODES: BlendMode[] = ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'color-dodge', 'soft-light', 'difference', 'hard-light'];

/** Per-clip entrance / exit animation, composited with the clip's fade + transform. */
export type TransitionType = 'none' | 'fade' | 'slide-l' | 'slide-r' | 'slide-u' | 'slide-d' | 'wipe' | 'zoom';
export type ClipTransition = { type: TransitionType; dur: number }; // dur in frames
export const TRANSITIONS: TransitionType[] = ['none', 'fade', 'slide-l', 'slide-r', 'slide-u', 'slide-d', 'wipe', 'zoom'];

/** Transform properties a visual clip can animate over time (Effect-Controls order). */
export type KfProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
/** Easing of the segment LEAVING a keyframe toward the next one. */
export type KfEase = 'linear' | 'in' | 'out' | 'inout';
/** One keyframe. `f` is the CLIP-LOCAL frame (clip.from-relative); `v` is the value. */
export type Keyframe = { f: number; v: number; ease?: KfEase };
/** Optional per-clip keyframe map. Absent / empty ⇒ the clip is static (today's behaviour). */
export type Keyframes = { [P in KfProp]?: Keyframe[] };

export type ClipBase = {
  id: string;
  /** start frame on the timeline */
  from: number;
  /** length on the timeline, in frames */
  durationInFrames: number;
  /** display name in the timeline block */
  name: string;
  /** position / scale / rotation / opacity (Effect Controls) */
  transform?: ClipTransform;
  /** links footage video ↔ its split audio (move/trim/delete together) */
  linkId?: string;
  /** true when the user has unlinked a linked pair (edit independently) */
  unlinked?: boolean;
  /** fade-in / fade-out length in frames (opacity for visuals, volume for audio) */
  fadeIn?: number;
  fadeOut?: number;
  /** colour label (hex) shown on the timeline block */
  color?: string;
  /** colour grade + creative look (CSS filter) for visual clips */
  filters?: ClipFilters;
  /** blend mode over the layers beneath this one (visual clips) */
  blend?: BlendMode;
  /** mirror the clip horizontally / vertically */
  flipH?: boolean;
  flipV?: boolean;
  /** animate transform props over time; keys are CLIP-LOCAL frames. Absent ⇒ static. */
  keyframes?: Keyframes;
  /** entrance / exit transition (composited with fade + transform). Absent ⇒ none. */
  transIn?: ClipTransition;
  transOut?: ClipTransition;
};

/** Imported footage, or a pre-rendered AI overlay (.mov) — both are video. */
export type VideoClip = ClipBase & {
  kind: 'video';
  src: string;
  /** trim frames off the source head (v4 name; not the deprecated startFrom) */
  trimBefore?: number;
  /** mute the video's own audio (footage audio is split onto a linked A-clip) */
  muted?: boolean;
  /** true for transparent ProRes 4444 .mov overlays (AI graphics). HTML5 <Video>
   *  can't decode ProRes → preview must use OffthreadVideo for these. */
  hasAlpha?: boolean;
  /** playback speed multiplier (1 = normal; 0.25..4). Undefined ⇒ 1. */
  speed?: number;
};

/** A live React/Remotion overlay (an AI graphic before it's flattened). */
export type TitleClip = ClipBase & {
  kind: 'title';
  text: string;
  color?: string;
  /** user text styling (defaults baked into KineticTitle when absent) */
  fontSize?: number;            // px
  fontWeight?: number;          // 400 / 700 / 900
  align?: 'left' | 'center' | 'right';
  bg?: string;                  // background box colour; 'none' = transparent
};

/** An audio-only clip on an A-track (music, voiceover, or split footage audio). */
export type AudioClip = ClipBase & {
  kind: 'audio';
  src: string;
  trimBefore?: number;
  /** clip level in decibels (0 dB = unchanged; - quieter, + louder) */
  gainDb?: number;
};

/** decibels → linear gain for Remotion <Audio volume>. 0 dB = 1.0. */
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** A solid colour, linear gradient, or drawn shape (rect / ellipse). Extends
 *  ClipBase, so it inherits transform / keyframes / filters / blend / transitions
 *  / fades / undo / autosave / duration for free — like every other visual clip. */
export type ShapeKind = 'rect' | 'ellipse' | 'solid' | 'gradient';
export const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'solid', 'gradient'];
export type ShapeClip = ClipBase & {
  kind: 'shape';
  shape: ShapeKind;
  fill: string;       // primary fill (hex)
  fill2?: string;     // 2nd gradient stop (hex), used when shape === 'gradient'
  angle?: number;     // gradient angle in degrees (default 90)
  radius?: number;    // corner radius (px) for 'rect'
};

export type Clip = VideoClip | TitleClip | ShapeClip | AudioClip;

export type TrackType = 'video' | 'audio';

export type Track = {
  id: string;
  type: TrackType;
  label: string;     // V1, V2… / A1, A2…
  clips: Clip[];
  /** muted (hidden video / silent audio), soloed, or locked (no edits) */
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
};

/** A named point on the timeline (jump + reference). */
export type Marker = { id: string; frame: number; label?: string };

export type EditorState = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  /** video tracks first (V1 = base), then audio tracks */
  tracks: Track[];
  /** timeline markers (chapter/cue points) */
  markers?: Marker[];
};

export const MAX_TRACKS = 100;

/** Re-number track labels by type after add/delete (V1..Vn, A1..An). */
export function relabelTracks(tracks: Track[]): Track[] {
  let v = 0;
  let a = 0;
  return tracks.map((t) =>
    t.type === 'video' ? { ...t, label: 'V' + ++v } : { ...t, label: 'A' + ++a },
  );
}
