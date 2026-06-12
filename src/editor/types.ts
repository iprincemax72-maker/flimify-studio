// The editor's single source of truth. The timeline IS a Remotion composition:
// this state is passed to <Player> as inputProps for live preview, and the
// SAME state renders to mp4 on export. Video tracks stack bottom→top (V1 base,
// higher V on top); audio tracks (A1, A2…) sit below. Each clip is a <Sequence>.

/** Effect-controls transform applied to a visual clip (Premiere-style). */
export type ClipTransform = {
  x: number;        // position offset from centre, in composition px
  y: number;
  scale: number;    // percent (100 = original)
  rotation: number; // degrees
  opacity: number;  // percent (100 = opaque)
};
export const DEFAULT_TRANSFORM: ClipTransform = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 };

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
};

/** A live React/Remotion overlay (an AI graphic before it's flattened). */
export type TitleClip = ClipBase & {
  kind: 'title';
  text: string;
  color?: string;
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

export type Clip = VideoClip | TitleClip | AudioClip;

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
