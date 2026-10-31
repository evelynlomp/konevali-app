import { describe, expect, it } from "vitest";

import { layoutField, MIN_HIDDEN_MS, NO_HIDING, RESTORE_GAP_MS, type FieldInput, type HidingState } from "@/lib/field-layout";
import { freeSpot, type Speaker, type Utterance } from "@/lib/session-store";

const NOW = 1_000_000_000;
const PHONE = { w: 339, h: 585 };
const DESKTOP = { w: 973, h: 553 };
const TEXTS = [
  "Peamine ettepanek on koondada koolitused ühte kohta, et kulud oleksid ülevaatlikumad.",
  "Esiteks: Tallinna kontori kulud on sel kvartalil kasvanud umbes kaheksa protsenti.",
  "Me peaksime otsustama, kas Töötukassa koostööprojekt jääb samasse eelarvesse.",
  "Praegu jääb osa inimesi koosolekutel kõrvale, sest nad ei kuule kõike.",
];

/** n people placed the way the app places them; `active` has just spoken, the rest went quiet long ago. */
function crowd(n: number, size: { w: number; h: number }, active: number, text: string, now = NOW): FieldInput {
  const spots: { x: number; y: number }[] = [];
  const speakers: Speaker[] = Array.from({ length: n }, (_, i) => {
    spots.push(freeSpot(spots as Speaker[]));
    return { id: `p${i}`, name: ["Mari", "Jaan", "Evelyn", "Kõneleja 4", "Liis"][i % 5]!, color: "teal", ...spots[i]!, large: false, pinned: false, nameSource: "tuvastatud" };
  });
  const lastSpokeAt: Record<string, number> = {};
  speakers.forEach((s, i) => {
    if (i === active) lastSpokeAt[s.id] = now - 1_000;
    else if (i % 3 === 1) lastSpokeAt[s.id] = now - 40_000 - i * 1_000; // quiet
    else if (i % 3 === 2) lastSpokeAt[s.id] = now - 100_000 - i * 1_000; // long silent
    // i % 3 === 0: has never spoken
  });
  const utterances: Utterance[] = [{ id: "u1", speakerId: `p${active}`, time: "", at: now - 1_000, text, turn: "t" }];
  return { speakers, utterances, lastSpokeAt, now, size, rem: 18, hiding: null };
}

/** A phone-sized crowd where, without hiding, the active speaker's newest sentence has no place. */
function crowdedPhone() {
  for (const text of TEXTS) for (let active = 0; active < 15; active++) {
    const input = crowd(15, PHONE, active, text);
    if (layoutField(input).activeMissing.length) return { input, active };
  }
  throw new Error("no crowded scenario found");
}

describe("space-based hiding (phone)", () => {
  it("is off on desktop: nobody is ever hidden", () => {
    const { input } = crowdedPhone();
    const out = layoutField({ ...input, size: DESKTOP, hiding: null });
    expect(out.hiding).toBeNull();
  });

  it("hides quiet people until the active speaker fits next to their name", () => {
    const { input, active } = crowdedPhone();
    expect(layoutField(input).activeMissing).toEqual([`p${active}`]);

    const out = layoutField({ ...input, hiding: NO_HIDING });
    expect(out.activeMissing).toEqual([]);
    expect(Object.keys(out.hiding!.hidden).length).toBeGreaterThan(0);
  });

  it("hides only quiet or long-silent people, and fewer than all of them", () => {
    const { input } = crowdedPhone();
    const out = layoutField({ ...input, hiding: NO_HIDING });
    const hidden = Object.keys(out.hiding!.hidden);
    const candidates = input.speakers.filter((s) => ["quiet", "marker"].includes(out.activity.get(s.id)!.state));
    for (const id of hidden) expect(["quiet", "marker"]).toContain(out.activity.get(id)!.state);
    expect(hidden.length).toBeLessThan(candidates.length);
  });

  it("hides no one who was not needed", () => {
    const { input } = crowdedPhone();
    const out = layoutField({ ...input, hiding: NO_HIDING });
    const hidden = out.hiding!.hidden;
    for (const id of Object.keys(hidden)) {
      const without = { ...hidden };
      delete without[id];
      // With this one person back, the pass has to hide somebody again: that is, they were needed.
      const back = layoutField({ ...input, hiding: { hidden: without, changedAt: NOW + 1_000_000 } });
      expect(Object.keys(back.hiding!.hidden).length, `${id} was hidden without need`).toBeGreaterThan(Object.keys(without).length);
    }
  });

  it("never hides someone who is active or spoke recently", () => {
    const { input } = crowdedPhone();
    const recent = input.speakers.find((s) => input.lastSpokeAt[s.id] === undefined)!;
    const withRecent = { ...input, lastSpokeAt: { ...input.lastSpokeAt, [recent.id]: NOW - 12_000 }, utterances: [...input.utterances, { id: "u2", speakerId: recent.id, time: "", at: NOW - 12_000, text: "Olen nõus.", turn: "t2" }] };
    const out = layoutField({ ...withRecent, hiding: NO_HIDING });
    for (const id of Object.keys(out.hiding!.hidden)) expect(["quiet", "marker"]).toContain(out.activity.get(id)!.state);
    expect(out.hiding!.hidden[recent.id]).toBeUndefined();
  });

  it("brings a hidden person back as soon as they speak", () => {
    const { input } = crowdedPhone();
    const hidden = layoutField({ ...input, hiding: NO_HIDING }).hiding!;
    const back = Object.keys(hidden.hidden)[0]!;
    const out = layoutField({ ...input, lastSpokeAt: { ...input.lastSpokeAt, [back]: NOW - 500 }, hiding: hidden });
    expect(out.hiding!.hidden[back]).toBeUndefined();
  });

  it("is stable: running the same moment again changes nothing", () => {
    const { input } = crowdedPhone();
    const first = layoutField({ ...input, hiding: NO_HIDING });
    const second = layoutField({ ...input, hiding: first.hiding });
    expect(second.hiding).toEqual(first.hiding);
  });
});

describe("hysteresis", () => {
  it("keeps people hidden for a while, then restores them one at a time", () => {
    const { input } = crowdedPhone();
    let state: HidingState = layoutField({ ...input, hiding: NO_HIDING }).hiding!;
    const hiddenAt = NOW;
    const count = () => Object.keys(state.hidden).length;
    const start = count();
    expect(start).toBeGreaterThan(0);

    const pass = (ms: number) => { state = layoutField({ ...input, now: hiddenAt + ms, hiding: state }).hiding!; };

    pass(8_000); // calm already, but nobody has been hidden long enough
    expect(count()).toBe(start);

    pass(MIN_HIDDEN_MS + 20_000); // long enough, and every caption has expired
    expect(count()).toBe(start - 1);

    pass(MIN_HIDDEN_MS + 20_000 + 1_000); // too soon after the last change
    expect(count()).toBe(start - 1);

    pass(MIN_HIDDEN_MS + 20_000 + RESTORE_GAP_MS);
    expect(count()).toBe(Math.max(0, start - 2));
  });

  it("does not restore anyone while somebody is speaking", () => {
    const { input, active } = crowdedPhone();
    const hidden = layoutField({ ...input, hiding: NO_HIDING }).hiding!;
    // long after the hiding, but the same speaker has just said something again
    const later = { ...input, now: NOW + 30_000, lastSpokeAt: { ...input.lastSpokeAt, [`p${active}`]: NOW + 29_000 } };
    const out = layoutField({ ...later, hiding: hidden });
    expect(out.activity.get(`p${active}`)!.state).toBe("active");
    expect(Object.keys(out.hiding!.hidden)).toEqual(Object.keys(hidden.hidden));
  });
});

describe("cost", () => {
  it("lays out 15 people on a phone fast enough for a once-a-second pass", () => {
    const { input } = crowdedPhone();
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) layoutField({ ...input, hiding: NO_HIDING });
    expect((performance.now() - t0) / 10).toBeLessThan(150);
  });
});
