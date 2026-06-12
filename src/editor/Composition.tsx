// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s. Honours per-clip fades + per-track mute/solo.
import { AbsoluteFill, Audio, OffthreadVideo, Video, Sequence, getRemotionEnvironment, useCurrentFrame } from 'remotion';
import { DEFAULT_TRANSFORM, dbToGain, type Clip, type VideoClip, type TitleClip, type AudioClip, type EditorState } from './types';
import { KineticTitle } from './overlays';

const VID_STYLE = { width: '100%', height: '100%', objectFit: 'cover' as const };

// fade multiplier (0..1) from the clip-local frame + fade lengths
const fadeMul = (frame: number, dur: number, fin?: number, fout?: number) => {
  let m = 1;
  if (fin && fin > 0) m = Math.min(m, frame / fin);
  if (fout && fout > 0) m = Math.min(m, (dur - frame) / fout);
  return Math.max(0, Math.min(1, m));
};

// Video element for the Player. Native <Video> (HTML5) decodes mp4 footage AND
// transparent WebM (VP8/VP9 alpha) AI overlays; <OffthreadVideo> for server render.
const VideoLayer: React.FC<{ clip: VideoClip }> = ({ clip }) =>
  getRemotionEnvironment().isRendering
    ? <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} transparent={!!clip.hasAlpha} style={VID_STYLE} />
    : <Video src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} pauseWhenBuffering style={VID_STYLE} />;

const AudioClipView: React.FC<{ clip: AudioClip }> = ({ clip }) => (
  <Audio
    src={clip.src}
    trimBefore={clip.trimBefore}
    volume={(f) => dbToGain(clip.gainDb ?? 0) * fadeMul(f, clip.durationInFrames, clip.fadeIn, clip.fadeOut)}
  />
);

const VisualClipView: React.FC<{ clip: VideoClip | TitleClip }> = ({ clip }) => {
  const t = clip.transform || DEFAULT_TRANSFORM;
  const fade = fadeMul(useCurrentFrame(), clip.durationInFrames, clip.fadeIn, clip.fadeOut);
  const inner = clip.kind === 'video' ? <VideoLayer clip={clip} /> : <KineticTitle text={clip.text} color={clip.color} />;
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale / 100}) rotate(${t.rotation}deg)`,
        transformOrigin: 'center center',
        opacity: (t.opacity / 100) * fade,
      }}
    >
      {inner}
    </AbsoluteFill>
  );
};

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) =>
  clip.kind === 'audio' ? <AudioClipView clip={clip} /> : <VisualClipView clip={clip} />;

export const TimelineComposition: React.FC<{ state: EditorState }> = ({ state }) => {
  const soloed = state.tracks.some((t) => t.solo);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {state.tracks.map((track) => {
        // soloing any track silences the rest; otherwise muted tracks drop out
        if (soloed ? !track.solo : track.muted) return null;
        return (
          <AbsoluteFill key={track.id}>
            {track.clips.map((clip) => (
              <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames}>
                <ClipView clip={clip} />
              </Sequence>
            ))}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
