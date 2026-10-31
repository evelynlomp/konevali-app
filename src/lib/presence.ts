import type { Utterance } from "./session-store";

/** Attention rank: 0 = speaking now, 1 = spoke just before, … ; Infinity = never spoke. */
export function attentionRanks(utterances: Utterance[], activeId: string | null) {
  const order: string[] = activeId ? [activeId] : [];
  for (let i = utterances.length - 1; i >= 0 && order.length < 12; i--) {
    const id = utterances[i]!.speakerId;
    if (!order.includes(id)) order.push(id);
  }
  return (id: string) => { const r = order.indexOf(id); return r < 0 ? Infinity : r; };
}
/** Presence 0..1 from rank — prominence falls quickly so large groups stay calm. */
export const presenceFromRank = (r: number) => (r === 0 ? 1 : r === Infinity ? 0.12 : Math.max(0.16, [1, 0.62, 0.42, 0.3][r] ?? 0.3 - (r - 3) * 0.03));
/** How many recent sentences stay visible near each participant (self-cleaning memory). */
export const memoryFromRank = (r: number) => [5, 3, 2][r] ?? 0;
export const EMPHASIS = [1, 0.7, 0.45, 0.22, 0.12];

/*
 * Time-based activity. The field shows conversational activity, not a roster:
 * whoever spoke a moment ago is bright and has captions, then they settle into
 * a small quiet name, and after a long silence into a minimal marker. Position
 * is never touched here.
 */
export const ACTIVE_MS = 6_000;
export const RECENT_MS = 25_000;
export const MARKER_MS = 60_000;
/** A caption keeps full strength this long, then fades out by RECENT_MS. */
export const CAPTION_FULL_MS = 12_000;

export type ActivityState = "active" | "recent" | "quiet" | "marker";

export interface Activity {
  state: ActivityState;
  /** 0..1, drives name size and glow. 0 for markers. */
  presence: number;
  neverSpoke: boolean;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * Math.min(1, Math.max(0, t));

/**
 * active  ≤ 6 s since the last sentence: bright, captions shown
 * recent  ≤ 25 s: toned down, only the latest sentence shown
 * quiet   ≤ 60 s (or never spoke): small name, no captions
 * marker  > 60 s: a dot; the name appears on hover or focus
 */
export function activityOf(lastSpokeAt: number | undefined, now: number): Activity {
  if (lastSpokeAt === undefined) return { state: "quiet", presence: 0.16, neverSpoke: true };
  const age = Math.max(0, now - lastSpokeAt);
  if (age <= ACTIVE_MS) return { state: "active", presence: 1, neverSpoke: false };
  if (age <= RECENT_MS) return { state: "recent", presence: lerp(1, 0.3, (age - ACTIVE_MS) / (RECENT_MS - ACTIVE_MS)), neverSpoke: false };
  if (age <= MARKER_MS) return { state: "quiet", presence: lerp(0.3, 0.16, (age - RECENT_MS) / (MARKER_MS - RECENT_MS)), neverSpoke: false };
  return { state: "marker", presence: 0, neverSpoke: false };
}

/** Opacity multiplier for a caption of the given age (ms). */
export const captionFade = (age: number) =>
  age <= CAPTION_FULL_MS ? 1 : Math.max(0, 1 - (age - CAPTION_FULL_MS) / (RECENT_MS - CAPTION_FULL_MS));

/** How many sentences each state may show next to the name. */
export const CAPTION_LINES: Record<ActivityState, number> = { active: 3, recent: 1, quiet: 0, marker: 0 };

/** Sentences still young enough to show, per speaker, newest first. */
export function recentLines(utterances: Utterance[], now: number): Map<string, Utterance[]> {
  const bySpeaker = new Map<string, Utterance[]>();
  for (let i = utterances.length - 1; i >= 0; i--) {
    const u = utterances[i]!;
    if (now - u.at >= RECENT_MS) break; // chronological, so everything earlier is older still
    const list = bySpeaker.get(u.speakerId);
    if (list) list.push(u);
    else bySpeaker.set(u.speakerId, [u]);
  }
  return bySpeaker;
}
