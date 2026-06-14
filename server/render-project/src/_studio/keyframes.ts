// Keyframes — animate a visual clip's transform (x, y, scale, rotation, opacity)
// over time. All keyframe frames are CLIP-LOCAL (relative to clip.from), so they
// survive clip moves/trims with zero remapping. A clip with no keyframe map (or
// an empty one) is treated exactly as today: every reader falls back to the
// static transform value, so existing projects render byte-for-byte identically.
import { Easing, interpolate } from 'remotion';
import type { Clip, Keyframe, Keyframes, KfEase, KfProp } from './types';

/** The transform properties that can be keyframed (Effect-Controls order). */
export const KF_PROPS: KfProp[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];

// Map our four ease names → a Remotion easing fn. 'linear' is the identity ramp;
// in/out/inout wrap a cubic curve (Premiere-style accel / decel / smooth).
const EASING: Record<KfEase, (t: number) => number> = {
  linear: Easing.linear,
  in: Easing.in(Easing.cubic),
  out: Easing.out(Easing.cubic),
  inout: Easing.inOut(Easing.cubic),
};
const easingFor = (e?: KfEase): ((t: number) => number) => EASING[e ?? 'linear'] ?? Easing.linear;

// read a clip's (optional) keyframe map without widening the Clip union everywhere
const mapOf = (clip: Clip): Keyframes | undefined => (clip as { keyframes?: Keyframes }).keyframes;

/** A clip's keyframe track for `prop`, copied + sorted ascending by frame; undefined when none. */
export function kfTrack(clip: Clip, prop: KfProp): Keyframe[] | undefined {
  const ks = mapOf(clip)?.[prop];
  if (!ks || ks.length === 0) return undefined;
  return [...ks].sort((a, b) => a.f - b.f);
}

/** True iff `clip` animates `prop` (has ≥1 keyframe) — the stopwatch's on/off state. */
export function hasKf(clip: Clip, prop: KfProp): boolean {
  const ks = mapOf(clip)?.[prop];
  return !!ks && ks.length > 0;
}

/**
 * Value of `prop` at clip-local `localFrame`:
 *   • no keyframe track            → `fallback` (the static transform value — unchanged behaviour)
 *   • before the first / after the last key → clamped to that key's value (hold)
 *   • between two keys             → eased `interpolate()` across that segment, using the
 *                                    easing stored on the LEFT key (how the value leaves it).
 * This is the single function Composition.tsx swaps in for each static `t.*` read.
 */
export function kfValue(clip: Clip, prop: KfProp, localFrame: number, fallback: number): number {
  const ks = kfTrack(clip, prop);
  if (!ks) return fallback;
  if (ks.length === 1) return ks[0].v;
  if (localFrame <= ks[0].f) return ks[0].v;
  const last = ks[ks.length - 1];
  if (localFrame >= last.f) return last.v;
  // locate the segment [a, b] containing localFrame
  let a = ks[0];
  let b = ks[1];
  for (let i = 0; i < ks.length - 1; i++) {
    if (localFrame >= ks[i].f && localFrame <= ks[i + 1].f) { a = ks[i]; b = ks[i + 1]; break; }
  }
  if (a.f === b.f) return b.v;
  return interpolate(localFrame, [a.f, b.f], [a.v, b.v], {
    easing: easingFor(a.ease),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Union of every keyframe frame across all props, sorted — for timeline dots + prev/next nav. */
export function kfFrames(clip: Clip): number[] {
  const kf = mapOf(clip);
  if (!kf) return [];
  const set = new Set<number>();
  for (const p of KF_PROPS) for (const k of kf[p] || []) set.add(k.f);
  return Array.from(set).sort((a, b) => a - b);
}

// ── immutable editors (used by App's keyframe handler) ─────────────────────────

/** Insert or update the key for `prop` at clip-local frame `f`. Returns a NEW map. */
export function setKf(kf: Keyframes | undefined, prop: KfProp, f: number, v: number, ease?: KfEase): Keyframes {
  const next: Keyframes = { ...(kf || {}) };
  const track = next[prop] ? [...next[prop]!] : [];
  const i = track.findIndex((k) => k.f === f);
  if (i >= 0) track[i] = { ...track[i], v, ...(ease ? { ease } : {}) };
  else track.push({ f, v, ...(ease ? { ease } : {}) });
  track.sort((a, b) => a.f - b.f);
  next[prop] = track;
  return next;
}

/** Remove the key for `prop` at clip-local frame `f`. Drops the track when empty,
 *  and returns `undefined` when the whole map empties (so the clip becomes static again). */
export function removeKf(kf: Keyframes | undefined, prop: KfProp, f: number): Keyframes | undefined {
  if (!kf || !kf[prop]) return kf;
  const track = kf[prop]!.filter((k) => k.f !== f);
  const next: Keyframes = { ...kf };
  if (track.length) next[prop] = track; else delete next[prop];
  return Object.keys(next).length ? next : undefined;
}

/** Remove the entire track for `prop` (stopwatch toggled OFF). `undefined` when the map empties. */
export function clearKf(kf: Keyframes | undefined, prop: KfProp): Keyframes | undefined {
  if (!kf || !kf[prop]) return kf;
  const next: Keyframes = { ...kf };
  delete next[prop];
  return Object.keys(next).length ? next : undefined;
}

/** A single keyframe mutation, dispatched from EffectControls → App. */
export type KfMutation =
  | { kind: 'set'; prop: KfProp; f: number; v: number; ease?: KfEase }
  | { kind: 'remove'; prop: KfProp; f: number }
  | { kind: 'clear'; prop: KfProp };

/** Apply a mutation to a keyframe map immutably (App calls this inside updateClip). */
export function applyKf(kf: Keyframes | undefined, m: KfMutation): Keyframes | undefined {
  if (m.kind === 'set') return setKf(kf, m.prop, m.f, m.v, m.ease);
  if (m.kind === 'remove') return removeKf(kf, m.prop, m.f);
  return clearKf(kf, m.prop);
}
