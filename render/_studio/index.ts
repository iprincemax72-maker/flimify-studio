// Standalone Remotion entry for Flimify Studio exports. Kept separate from the
// extension's Root.tsx (278 comps) so studio renders never touch that file.
// Rendered by the studio-bridge:
//   npx remotion render src/_studio/index.ts StudioTimeline <out> --props=<state>
import { registerRoot } from 'remotion';
import { StudioRoot } from './Root';

registerRoot(StudioRoot);
