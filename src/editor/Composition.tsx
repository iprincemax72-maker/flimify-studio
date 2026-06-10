// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s.
import { AbsoluteFill, Audio, OffthreadVideo, Sequence } from 'remotion';
import type { Clip, EditorState } from './types';
import { KineticTitle } from './overlays';

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (clip.kind === 'video') {
    // OffthreadVideo previews in the Player (falls back to an HTML5 video tag)
    // AND renders frame-accurately server-side via ffmpeg.
    return (
      <OffthreadVideo
        src={clip.src}
        trimBefore={clip.trimBefore}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }
  if (clip.kind === 'audio') {
    return <Audio src={clip.src} trimBefore={clip.trimBefore} />;
  }
  return <KineticTitle text={clip.text} color={clip.color} />;
};

export const TimelineComposition: React.FC<{ state: EditorState }> = ({ state }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {state.tracks.map((track) => (
        <AbsoluteFill key={track.id}>
          {track.clips.map((clip) => (
            <Sequence
              key={clip.id}
              from={clip.from}
              durationInFrames={clip.durationInFrames}
            >
              <ClipView clip={clip} />
            </Sequence>
          ))}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};
