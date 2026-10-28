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
