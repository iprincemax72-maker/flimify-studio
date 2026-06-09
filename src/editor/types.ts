// The editor's single source of truth. The timeline IS a Remotion composition:
// this state is passed to <Player> as inputProps for live preview, and the
// SAME state renders to mp4 on export. Tracks stack bottom→top (V1 footage at
// the base, V2/V3 AI overlays on top); each clip is a Remotion <Sequence>.

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
};

/** A live React/Remotion overlay (an AI graphic before it's flattened). */
export type TitleClip = ClipBase & {
  kind: 'title';
  text: string;
  color?: string;
};

export type Clip = VideoClip | TitleClip;

export type Track = {
  id: string;
  label: string;     // V1, V2, V3…
  clips: Clip[];
};

export type EditorState = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  /** index 0 = bottom layer (base footage); later tracks render on top */
  tracks: Track[];
};
