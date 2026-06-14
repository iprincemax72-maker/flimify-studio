// The timeline rendered AS a Remotion composition. This exact component is what
// <Player> previews live AND what @remotion/renderer exports to mp4 — one
// composition, no preview/export split. Tracks layer bottom→top; clips are
// time-positioned <Sequence>s. Honours per-clip fades + per-track mute/solo.
import { AbsoluteFill, Audio, OffthreadVideo, Video, Sequence, getRemotionEnvironment, useCurrentFrame } from 'remotion';
import { DEFAULT_TRANSFORM, dbToGain, filtersToCss, type Clip, type VideoClip, type TitleClip, type AudioClip, type ShapeClip, type EditorState, type TransitionType } from './types';
import { kfValue } from './keyframes';
import { ShapeLayer } from './shapes';
import { KineticTitle } from './overlays';

const VID_STYLE = { width: '100%', height: '100%', objectFit: 'cover' as const };

// fade multiplier (0..1) from the clip-local frame + fade lengths
const fadeMul = (frame: number, dur: number, fin?: number, fout?: number) => {
  let m = 1;
  if (fin && fin > 0) m = Math.min(m, frame / fin);
  if (fout && fout > 0) m = Math.min(m, (dur - frame) / fout);
  return Math.max(0, Math.min(1, m));
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// entrance/exit transition → extra opacity, percent-translate, scale, clip-path.
// p is 0..1 "presence" (0 = fully out/hidden side, 1 = fully in). One fn drives in AND out.
const transFx = (type: TransitionType, p: number) => {
  const q = 1 - p;
  switch (type) {
    case 'fade':    return { o: p, tx: 0,        ty: 0,        s: 1,             clip: '' };
    case 'slide-l': return { o: 1, tx: q * -100, ty: 0,        s: 1,             clip: '' };
    case 'slide-r': return { o: 1, tx: q * 100,  ty: 0,        s: 1,             clip: '' };
    case 'slide-u': return { o: 1, tx: 0,        ty: q * -100, s: 1,             clip: '' };
    case 'slide-d': return { o: 1, tx: 0,        ty: q * 100,  s: 1,             clip: '' };
    case 'zoom':    return { o: p, tx: 0,        ty: 0,        s: 0.6 + 0.4 * p, clip: '' };
    case 'wipe':    return { o: 1, tx: 0,        ty: 0,        s: 1,             clip: `inset(0 ${q * 100}% 0 0)` };
    default:        return { o: 1, tx: 0,        ty: 0,        s: 1,             clip: '' };
  }
};

// Video element for the Player. Native <Video> (HTML5) decodes mp4 footage AND
// transparent WebM (VP8/VP9 alpha) AI overlays; <OffthreadVideo> for server render.
const VideoLayer: React.FC<{ clip: VideoClip }> = ({ clip }) =>
  getRemotionEnvironment().isRendering
    ? <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} transparent={!!clip.hasAlpha} playbackRate={clip.speed ?? 1} style={VID_STYLE} />
    : <Video src={clip.src} trimBefore={clip.trimBefore} muted={clip.muted} pauseWhenBuffering playbackRate={clip.speed ?? 1} style={VID_STYLE} />;

const AudioClipView: React.FC<{ clip: AudioClip }> = ({ clip }) => (
  <Audio
    src={clip.src}
    trimBefore={clip.trimBefore}
    volume={(f) => dbToGain(kfValue(clip, 'volume', f, clip.gainDb ?? 0)) * fadeMul(f, clip.durationInFrames, clip.fadeIn, clip.fadeOut)}
  />
);

const VisualClipView: React.FC<{ clip: VideoClip | TitleClip | ShapeClip }> = ({ clip }) => {
  // clip-local frame (0 at clip.from): the domain both fades AND keyframes live in.
  const frame = useCurrentFrame();
  const t = clip.transform || DEFAULT_TRANSFORM;
  const fade = fadeMul(frame, clip.durationInFrames, clip.fadeIn, clip.fadeOut);
  const inner = clip.kind === 'video'
    ? <VideoLayer clip={clip} />
    : clip.kind === 'shape'
      ? <ShapeLayer shape={clip.shape} fill={clip.fill} fill2={clip.fill2} angle={clip.angle} radius={clip.radius} />
      : <KineticTitle text={clip.text} color={clip.color} fontSize={clip.fontSize} fontWeight={clip.fontWeight} align={clip.align} bg={clip.bg} />;
  // each transform prop: animated value when the clip has a keyframe track for it,
  // otherwise the static transform value (so un-keyframed clips are unchanged).
  const x = kfValue(clip, 'x', frame, t.x);
  const y = kfValue(clip, 'y', frame, t.y);
  const scale = kfValue(clip, 'scale', frame, t.scale);
  const rotation = kfValue(clip, 'rotation', frame, t.rotation);
  const opacity = kfValue(clip, 'opacity', frame, t.opacity);
  const sx = (clip.flipH ? -1 : 1) * (scale / 100);
  const sy = (clip.flipV ? -1 : 1) * (scale / 100);
  const filter = filtersToCss(clip.filters);
  // entrance / exit transitions, composited with fade + transform (clip-local frame)
  const dur = clip.durationInFrames;
  const fxIn = clip.transIn && clip.transIn.type !== 'none' && clip.transIn.dur > 0
    ? transFx(clip.transIn.type, clamp01(frame / clip.transIn.dur)) : null;
  const fxOut = clip.transOut && clip.transOut.type !== 'none' && clip.transOut.dur > 0
    ? transFx(clip.transOut.type, clamp01((dur - frame) / clip.transOut.dur)) : null;
  const tOpacity = (fxIn ? fxIn.o : 1) * (fxOut ? fxOut.o : 1);
  const tTx = (fxIn ? fxIn.tx : 0) + (fxOut ? fxOut.tx : 0);
  const tTy = (fxIn ? fxIn.ty : 0) + (fxOut ? fxOut.ty : 0);
  const tScale = (fxIn ? fxIn.s : 1) * (fxOut ? fxOut.s : 1);
  const tClip = (fxIn && fxIn.clip) || (fxOut && fxOut.clip) || '';
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${x}px, ${y}px) translate(${tTx}%, ${tTy}%) scale(${sx * tScale}, ${sy * tScale}) rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        opacity: (opacity / 100) * fade * tOpacity,
        ...(tClip ? { clipPath: tClip } : {}),
        ...(filter ? { filter } : {}),
        ...(clip.blend && clip.blend !== 'normal' ? { mixBlendMode: clip.blend as React.CSSProperties['mixBlendMode'] } : {}),
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
