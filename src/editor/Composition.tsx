// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s.
import { AbsoluteFill, Audio, OffthreadVideo, Sequence } from 'remotion';
import { DEFAULT_TRANSFORM, type Clip, type EditorState } from './types';
import { KineticTitle } from './overlays';

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (clip.kind === 'audio') {
    return <Audio src={clip.src} trimBefore={clip.trimBefore} />;
  }
  // visual clips honour the Effect-Controls transform (position/scale/rotation/opacity)
  const t = clip.transform || DEFAULT_TRANSFORM;
  const inner =
    clip.kind === 'video' ? (
      // OffthreadVideo previews in the Player AND renders frame-accurately via ffmpeg.
      <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <KineticTitle text={clip.text} color={clip.color} />
    );
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale / 100}) rotate(${t.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: t.opacity / 100,
      }}
    >
      {inner}
    </AbsoluteFill>
  );
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
