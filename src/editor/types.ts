// The editor's single source of truth. The timeline IS a Remotion composition:
// this state is passed to <Player> as inputProps for live preview, and the
// SAME state renders to mp4 on export. Video tracks stack bottom→top (V1 base,
// higher V on top); audio tracks (A1, A2…) sit below. Each clip is a <Sequence>.

export type ClipBase = {
  id: string;
  /** start frame on the timeline */
  from: number;
  /** length on the timeline, in frames */
  durationInFrames: number;
  /** display name in the timeline block */
  name: string;
};

/** Imported footage, or a pre-rendered AI overlay (.mov) — both are video. */
export type VideoClip = ClipBase & {
  kind: 'video';
  src: string;
  /** trim frames off the source head (v4 name; not the deprecated startFrom) */
  trimBefore?: number;
  /** mute the video's own audio (footage audio is split onto a linked A-clip) */
  muted?: boolean;
  /** links footage video + its split audio clip so they delete together */
  linkId?: string;
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
  /** links split footage audio back to its video clip */
  linkId?: string;
};

export type Clip = VideoClip | TitleClip | AudioClip;

export type TrackType = 'video' | 'audio';

export type Track = {
  id: string;
  type: TrackType;
  label: string;     // V1, V2… / A1, A2…
  clips: Clip[];
};

export type EditorState = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  /** video tracks first (V1 = base), then audio tracks */
  tracks: Track[];
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
