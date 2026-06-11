// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s.
import { AbsoluteFill, Audio, OffthreadVideo, Video, Sequence, getRemotionEnvironment } from 'remotion';
import { DEFAULT_TRANSFORM, dbToGain, type Clip, type VideoClip, type EditorState } from './types';
import { KineticTitle } from './overlays';

const VID_STYLE = { width: '100%', height: '100%', objectFit: 'cover' as const };

// Video element for the Player. Native <Video> (HTML5) decodes mp4 footage AND
// transparent WebM (VP8/VP9 alpha) AI overlays — Chromium composites the alpha —
// and plays smoothly with no flicker. (ProRes .mov is NOT decodable in the
// browser/Electron at all — that's why AI overlays are now rendered as WebM
// alpha, not ProRes.) <OffthreadVideo> is used only for server-side render.
const VideoLayer: React.FC<{ clip: VideoClip }> = ({ clip }) =>
  getRemotionEnvironment().isRendering
    ? <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} transparent={!!clip.hasAlpha} style={VID_STYLE} />
    : <Video src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} pauseWhenBuffering style={VID_STYLE} />;

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (clip.kind === 'audio') {
    return <Audio src={clip.src} trimBefore={clip.trimBefore} volume={dbToGain(clip.gainDb ?? 0)} />;
  }
  // visual clips honour the Effect-Controls transform (position/scale/rotation/opacity)
  const t = clip.transform || DEFAULT_TRANSFORM;
  const inner =
    clip.kind === 'video' ? (
      <VideoLayer clip={clip} />
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
