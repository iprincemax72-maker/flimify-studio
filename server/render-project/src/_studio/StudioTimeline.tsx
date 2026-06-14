// Flimify Studio — the export composition.
//
// IMPORTANT: the export now renders the EXACT same component the editor previews
// with @remotion/player — TimelineComposition from Composition.tsx (plus its deps
// types.ts / keyframes.ts / overlays.tsx / shapes.tsx, copied into this folder).
// That guarantees "what you see is what exports": transform, keyframes, fades,
// colour filters, blend, flip, transitions, shapes, audio, mute/solo — all of it
// renders identically. Previously this was a stripped-down hand-copy that drifted
// behind the preview (it ignored transform/keyframes/etc.), which made the export
// look different from the timeline.
//
// Keep render/_studio/{Composition,types,keyframes,overlays,shapes} in sync with
// src/editor/* (copied at build/install time).
export { TimelineComposition as StudioTimeline } from './Composition';
export type { EditorState as StudioState } from './types';
