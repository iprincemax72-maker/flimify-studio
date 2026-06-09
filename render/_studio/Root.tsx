import { Composition } from 'remotion';
import { StudioTimeline, type StudioState } from './StudioTimeline';

const FALLBACK: StudioState = { fps: 30, width: 1920, height: 1080, durationInFrames: 240, tracks: [] };

export const StudioRoot: React.FC = () => {
  return (
    <Composition
      id="StudioTimeline"
      component={StudioTimeline}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ state: FALLBACK }}
      calculateMetadata={({ props }) => {
        const s = (props as { state?: StudioState }).state || FALLBACK;
        return {
          durationInFrames: Math.max(1, s.durationInFrames || 240),
          fps: s.fps || 30,
          width: s.width || 1920,
          height: s.height || 1080,
        };
      }}
    />
  );
};
