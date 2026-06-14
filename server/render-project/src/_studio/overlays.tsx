// A live, frame-driven overlay — stands in for an AI-generated graphic before
// it's flattened to a .mov. Transparent background so it composites over the
// footage track below it. Same patterns Flimify already generates.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const KineticTitle: React.FC<{ text: string; color?: string; fontSize?: number; fontWeight?: number; align?: 'left' | 'center' | 'right'; bg?: string }> = ({
  text,
  color = '#ffffff',
  fontSize = 88,
  fontWeight = 800,
  align = 'center',
  bg,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // snappy spring in, hold, ease out in the last 12 frames
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const y = interpolate(enter, [0, 1], [70, 0]);
  const opacity = Math.min(enter, exit);

  return (
    <AbsoluteFill
      style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 150 }}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity,
          fontSize,
          fontWeight,
          color,
          textAlign: align,
          whiteSpace: 'pre-wrap',
          fontFamily: 'Inter, system-ui, sans-serif',
          letterSpacing: '-0.02em',
          padding: bg === 'none' ? 0 : '14px 34px',
          borderRadius: 16,
          background: bg === 'none' ? 'transparent' : (bg ?? 'rgba(10,12,16,0.55)'),
          backdropFilter: bg === 'none' ? undefined : 'blur(6px)',
          textShadow: '0 6px 34px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
