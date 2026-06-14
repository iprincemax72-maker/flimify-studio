// A solid colour, linear gradient, or drawn shape (rect / ellipse) — the visual
// LEAF of a 'shape' clip. Like KineticTitle (overlays.tsx) it renders a
// transparent-background, full-bleed element and applies NOTHING transform /
// opacity / filter / blend related: the wrapping <AbsoluteFill> in
// VisualClipView (Composition.tsx) already composites position, scale, rotation,
// flip, opacity, fade, keyframes, colour filters, blend mode and in/out
// transitions over the layers beneath it. So shapes honour the whole pipeline
// for free — this component only paints the fill.
import { AbsoluteFill } from 'remotion';

export const ShapeLayer: React.FC<{
  shape: 'rect' | 'ellipse' | 'solid' | 'gradient';
  fill?: string;
  fill2?: string;
  angle?: number;
  radius?: number;
}> = ({ shape, fill = '#d97757', fill2, angle = 90, radius = 0 }) => {
  // 'solid' / 'gradient' fill the WHOLE frame (full-bleed backgrounds)
  if (shape === 'solid' || shape === 'gradient') {
    const background =
      shape === 'gradient'
        ? `linear-gradient(${angle}deg, ${fill}, ${fill2 ?? fill})`
        : fill;
    return <AbsoluteFill style={{ background }} />;
  }
  // 'rect' / 'ellipse' draw a CENTRED box — resize it with the clip's Scale
  // (Effect Controls → transform.scale), reposition with Position (x/y).
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: '50%',
          height: '50%',
          background: fill,
          borderRadius: shape === 'ellipse' ? '50%' : radius,
        }}
      />
    </AbsoluteFill>
  );
};
