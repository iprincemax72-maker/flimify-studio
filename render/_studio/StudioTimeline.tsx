// Flimify Studio — the export composition. The app's timeline state renders
// here exactly as it previews in @remotion/player (same track/clip model), so
// "what you see is what exports". Driven by props.state from the studio-bridge.
import {
  AbsoluteFill, OffthreadVideo, Sequence,
  interpolate, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';

type Clip = {
  id: string;
  kind: 'video' | 'title';
  from: number;
  durationInFrames: number;
  src?: string;
  trimBefore?: number;
  text?: string;
  color?: string;
};
type Track = { id: string; clips: Clip[] };
export type StudioState = {
  fps: number; width: number; height: number; durationInFrames: number; tracks: Track[];
};

const KineticTitle: React.FC<{ text: string; color?: string }> = ({ text, color = '#ffffff' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(enter, [0, 1], [70, 0]);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 150 }}>
      <div style={{
        transform: `translateY(${y}px)`, opacity: Math.min(enter, exit),
        fontSize: 88, fontWeight: 800, color, fontFamily: 'Inter, system-ui, sans-serif',
        letterSpacing: '-0.02em', padding: '14px 34px', borderRadius: 16,
        background: 'rgba(10,12,16,0.55)', textShadow: '0 6px 34px rgba(0,0,0,0.5)',
      }}>{text}</div>
    </AbsoluteFill>
  );
};

const ClipView: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (clip.kind === 'video' && clip.src) {
    return <OffthreadVideo src={clip.src} trimBefore={clip.trimBefore} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return <KineticTitle text={clip.text || ''} color={clip.color} />;
};

export const StudioTimeline: React.FC<{ state: StudioState }> = ({ state }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    {state.tracks.map((track) => (
      <AbsoluteFill key={track.id}>
        {track.clips.map((clip) => (
          <Sequence key={clip.id} from={clip.from} durationInFrames={clip.durationInFrames}>
            <ClipView clip={clip} />
          </Sequence>
        ))}
      </AbsoluteFill>
    ))}
  </AbsoluteFill>
);
