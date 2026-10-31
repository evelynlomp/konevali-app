import { captionVariants, layoutCaptions, MARGIN, nameBox, type BlockSpec, type Placement } from "./caption-layout";
import { activityOf, CAPTION_LINES, recentLines, type Activity } from "./presence";
import type { Speaker, Utterance } from "./session-store";

/*
 * One pass of the field's layout: who is how prominent, where each caption block goes,
 * and — on a phone only — who is left off the field to make room for an active speaker.
 * Pure, so the hiding rules can be tested without a browser.
 */

export const MAX_CAPTION_W = 288;
/** A field narrower than this (px) is treated as a phone. Wider fields never hide anyone. */
export const PHONE_MAX_W = 480;
/** Hysteresis: once hidden, someone stays hidden at least this long … */
export const MIN_HIDDEN_MS = 15_000;
/** … and the hidden set changes at most this often when people are coming back. */
export const RESTORE_GAP_MS = 4_000;

export const nameRem = (a: Activity, crowded: boolean) => (crowded ? 0.9 : 1) + a.presence * 0.45;

/** `hidden`: speakerId → when they were hidden. Persisted by the caller between passes. */
export interface HidingState { hidden: Record<string, number>; changedAt: number }
export const NO_HIDING: HidingState = { hidden: {}, changedAt: 0 };

export interface FieldInput {
  speakers: Speaker[];
  utterances: Utterance[];
  lastSpokeAt: Record<string, number>;
  now: number;
  size: { w: number; h: number };
  /** Root font size in px. */
  rem: number;
  /** Previous caption sides, so blocks do not hop between passes. */
  prefer?: Record<string, string>;
  /** null = never hide anyone (desktop). */
  hiding: HidingState | null;
}

export interface FieldLayout {
  activity: Map<string, Activity>;
  lines: Map<string, Utterance[]>;
  placements: Record<string, Placement | null>;
  /** null when hiding is off. */
  hiding: HidingState | null;
  /** Active speakers whose newest sentence has no place next to their name. */
  activeMissing: string[];
}

/** Quiet people are the only ones who may be hidden; anyone who spoke lately stays. */
const hideable = (a: Activity) => a.state === "quiet" || a.state === "marker";

export function layoutField(input: FieldInput): FieldLayout {
  const { speakers, utterances, lastSpokeAt, now, size, rem, prefer = {} } = input;
  const activity = new Map(speakers.map((s) => [s.id, activityOf(lastSpokeAt[s.id], now)]));
  const lines = recentLines(utterances, now);
  if (!size.w || !size.h) return { activity, lines, placements: {}, hiding: input.hiding, activeMissing: [] };

  const crowded = speakers.length > 8; // by the whole roster, so names do not resize when someone is hidden
  const maxW = Math.min(MAX_CAPTION_W, size.w - 2 * MARGIN);
  const variants = new Map<string, BlockSpec["variants"]>();
  for (const s of speakers) {
    const lim = CAPTION_LINES[activity.get(s.id)!.state];
    const mine = lim ? lines.get(s.id) : undefined;
    if (mine?.length) variants.set(s.id, captionVariants(mine.slice(0, lim).map((u) => u.text), maxW, rem));
  }

  /** Lay out everyone except `hidden`; report who is missing a good place for their newest sentence. */
  const attempt = (hidden: ReadonlySet<string>) => {
    const shown = speakers.filter((s) => !hidden.has(s.id));
    const names = shown.map((s) => {
      const a = activity.get(s.id)!;
      return nameBox(s.id, (s.x / 100) * size.w, (s.y / 100) * size.h, s.name, nameRem(a, crowded) * rem, { marker: a.state === "marker", underline: a.state === "active" });
    });
    const blocks: BlockSpec[] = shown
      .filter((s) => variants.has(s.id))
      .sort((a, b) => (lastSpokeAt[b.id] ?? 0) - (lastSpokeAt[a.id] ?? 0))
      .map((s) => ({ id: s.id, variants: variants.get(s.id)! }));
    const placements = layoutCaptions({ field: size, names, blocks, prefer });
    // a block placed far from its name ("roam") does not count as having a place
    const lacking = (ids: string[]) => ids.filter((id) => !placements[id] || placements[id]!.key === "roam");
    const activeMissing = lacking(blocks.filter((b) => activity.get(b.id)!.state === "active").map((b) => b.id));
    const anyMissing = lacking(blocks.map((b) => b.id));
    return { placements, activeMissing, anyMissing };
  };

  if (!input.hiding) {
    const r = attempt(new Set());
    return { activity, lines, placements: r.placements, hiding: null, activeMissing: r.activeMissing };
  }

  // Anyone who has started speaking again is shown again straight away.
  const hidden: Record<string, number> = {};
  for (const [id, at] of Object.entries(input.hiding.hidden)) {
    const a = activity.get(id);
    if (a && hideable(a)) hidden[id] = at;
  }
  let changedAt = input.hiding.changedAt;
  const ids = () => new Set(Object.keys(hidden));
  let res = attempt(ids());

  if (res.activeMissing.length) {
    // Make room for the active speaker: hide the least important, longest-silent person, one at a time.
    // People who have not spoken yet go first, then the longest-silent.
    const order = speakers
      .filter((s) => !hidden[s.id] && hideable(activity.get(s.id)!))
      .sort((a, b) => (lastSpokeAt[a.id] ?? -Infinity) - (lastSpokeAt[b.id] ?? -Infinity));
    const hiddenNow: string[] = [];
    for (const s of order) {
      if (!res.activeMissing.length) break;
      hidden[s.id] = now;
      hiddenNow.push(s.id);
      res = attempt(ids());
    }
    // Hiding in "least important first" order can hide people who were never in the way, so take
    // back everyone whose return does not make things worse, the most important first.
    for (const id of hiddenNow.sort((a, b) => (lastSpokeAt[b] ?? -Infinity) - (lastSpokeAt[a] ?? -Infinity))) {
      const rest = new Set(Object.keys(hidden).filter((h) => h !== id));
      const trial = attempt(rest);
      if (trial.activeMissing.length <= res.activeMissing.length) {
        delete hidden[id];
        res = trial;
      }
    }
    if (Object.values(hidden).some((at) => at === now)) changedAt = now;
  } else if (Object.keys(hidden).length && now - changedAt >= RESTORE_GAP_MS && ![...activity.values()].some((a) => a.state === "active")) {
    // Calm again: bring back one person at a time, the most recently active first, but only if
    // everyone who still has a caption keeps a good place (so they do not just have to be hidden again).
    const next = Object.keys(hidden)
      .filter((id) => now - hidden[id]! >= MIN_HIDDEN_MS)
      .sort((a, b) => (lastSpokeAt[b] ?? -Infinity) - (lastSpokeAt[a] ?? -Infinity))[0];
    if (next) {
      const rest = new Set(Object.keys(hidden).filter((id) => id !== next));
      const trial = attempt(rest);
      if (!trial.anyMissing.length) {
        delete hidden[next];
        changedAt = now;
        res = trial;
      }
    }
  }

  return { activity, lines, placements: res.placements, hiding: { hidden, changedAt }, activeMissing: res.activeMissing };
}
