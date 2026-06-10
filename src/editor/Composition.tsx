// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s.
import { AbsoluteFill, Audio, OffthreadVideo, Video, Sequence, getRemotionEnvironment } from 'remotion';
import { DEFAULT_TRANSFORM, dbToGain, type Clip, type EditorState } from './types';
import { KineticTitle } from './overlays';

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (clip.kind === 'audio') {
    return <Audio src={clip.src} trimBefore={clip.trimBefore} volume={dbToGain(clip.gainDb ?? 0)} />;
  }
  // visual clips honour the Effect-Controls transform (position/scale/rotation/opacity)
  const t = clip.transform || DEFAULT_TRANSFORM;
  const inner =
    clip.kind === 'video' ? (
      // Native <Video> plays smoothly in the <Player> (HTML5 element synced to the
      // timeline); <OffthreadVideo> is frame-accurate but FLICKERS during live
      // playback — it's a render component. So preview with <Video> and only use
      // <OffthreadVideo> when actually rendering. pauseWhenBuffering keeps the
      // Player in sync instead of glitching if a frame hasn't loaded yet.
      getRemotionEnvironment().isRendering ? (
        <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Video src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} pauseWhenBuffering style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )
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
