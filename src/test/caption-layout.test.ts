import { describe, expect, it } from "vitest";

import { freeSpot, type Speaker } from "@/lib/session-store";
import { captionVariants, layoutCaptions, MARGIN, nameBox, type BlockSpec, type NameBox, type Placement, type Rect } from "@/lib/caption-layout";

const TEXTS = [
  "Mul on küsimus.",
  "Kas see sisaldab ka Tartu koolitusi?",
  "Esiteks: Tallinna kontori kulud on sel kvartalil kasvanud umbes kaheksa protsenti.",
  "Peamine ettepanek on koondada koolitused ühte kohta, et kulud oleksid ülevaatlikumad.",
  "Me peaksime otsustama, kas Töötukassa koostööprojekt jääb samasse eelarvesse.",
  "Olen nõus.",
  "Praegu jääb osa inimesi koosolekutel kõrvale, sest nad ei kuule kõike.",
];

// small deterministic PRNG so failures are reproducible
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const FIELDS = { desktop: { w: 973, h: 553 }, phone: { w: 339, h: 585 } };

type Spread = "app" | "random";

function scenario(seed: number, n: number, field: { w: number; h: number }, active: number, recent: number, spread: Spread = "app") {
  const r = rng(seed);
  // "app": positions the way the app itself places new participants; "random": anywhere, the worst case
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) spots.push(spread === "app" ? freeSpot(spots as Speaker[]) : { x: 6 + r() * 88, y: 6 + r() * 79 });
  const names: NameBox[] = spots.map((sp, i) =>
    nameBox(`p${i}`, (sp.x / 100) * field.w, (sp.y / 100) * field.h, `Osaleja ${i + 1}`, i < active ? 21 : i < active + recent ? 18 : 15, { underline: i < active, marker: i >= active + recent && r() < 0.3 }),
  );
  const maxW = Math.min(288, field.w - 2 * MARGIN);
  const blocks: BlockSpec[] = names.slice(0, active + recent).map((nm, i) => {
    const count = i < active ? 3 : 1;
    const texts = Array.from({ length: count }, () => TEXTS[Math.floor(r() * TEXTS.length)]!);
    return { id: nm.id, variants: captionVariants(texts, maxW) };
  });
  return { names, blocks, placements: layoutCaptions({ field, names, blocks }) };
}

const nameRect = (n: NameBox): Rect => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h });
const intersect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertClean(names: NameBox[], placements: Record<string, Placement | null>, field: { w: number; h: number }) {
  const placed = Object.values(placements).filter((p): p is Placement => !!p);
  for (const p of placed) {
    expect(p.x).toBeGreaterThanOrEqual(MARGIN - 0.001);
    expect(p.y).toBeGreaterThanOrEqual(MARGIN - 0.001);
    expect(p.x + p.w).toBeLessThanOrEqual(field.w - MARGIN + 0.001);
    expect(p.y + p.h).toBeLessThanOrEqual(field.h - MARGIN + 0.001);
    for (const n of names) expect(intersect(p, nameRect(n)), `${p.id} covers name ${n.id}`).toBe(false);
  }
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) expect(intersect(placed[i]!, placed[j]!), `${placed[i]!.id} overlaps ${placed[j]!.id}`).toBe(false);
  return placed.length;
}

describe("caption layout engine", () => {
  /** Share of blocks that found room, overall and for the speakers who are active right now. */
  const rate = (n: number, field: { w: number; h: number }, active: number, recent: number, spread: Spread) => {
    let requested = 0, placed = 0, activeRequested = 0, activePlaced = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { names, blocks, placements } = scenario(seed, n, field, active, recent, spread);
      requested += blocks.length;
      placed += assertClean(names, placements, field); // fails on any overlap or out-of-field block
      for (const b of blocks.slice(0, active)) { activeRequested++; if (placements[b.id]) activePlaced++; }
    }
    return { all: placed / requested, active: activePlaced / activeRequested };
  };

  for (const n of [5, 10, 15]) {
    for (const [fname, field] of Object.entries(FIELDS)) {
      it(`never overlaps with ${n} participants on ${fname}`, () => {
        const typical = rate(n, field, 3, 2, "app");
        const everyone = rate(n, field, n, 0, "app");
        const scattered = rate(n, field, 3, 2, "random");
        console.log(`RATE ${n} ${fname}: typical all ${typical.all.toFixed(2)} active ${typical.active.toFixed(2)} | everyone-active ${everyone.all.toFixed(2)} | scattered all ${scattered.all.toFixed(2)} active ${scattered.active.toFixed(2)}`);
        // The newest sentence of an active speaker must have a place. A 339 px phone field with 15
        // people cannot hold that many blocks (that needs a different mobile layout), so there only
        // the no-overlap guarantee (asserted in rate()) applies.
        if (fname === "desktop") expect(typical.active).toBeGreaterThan(0.99);
        else if (n <= 5) expect(typical.active).toBeGreaterThan(0.95);
        else if (n <= 10) expect(typical.active).toBeGreaterThan(0.85);
      });
    }
  }

  it("leaves a block out instead of drawing it over something", () => {
    const field = { w: 200, h: 120 };
    const names = [nameBox("a", 100, 60, "Mari", 18)];
    const huge: BlockSpec = { id: "a", variants: [{ w: 190, h: 110, keep: 1 }] };
    expect(layoutCaptions({ field, names, blocks: [huge] })["a"]).toBeNull();
  });

  it("falls back to fewer lines when the full block does not fit", () => {
    const field = { w: 300, h: 120 };
    const names = [nameBox("a", 150, 60, "Mari", 18)];
    const block: BlockSpec = { id: "a", variants: [{ w: 280, h: 100, keep: 3 }, { w: 200, h: 30, keep: 1 }] };
    expect(layoutCaptions({ field, names, blocks: [block] })["a"]?.keep).toBe(1);
  });

  it("keeps a block on the side it had before when it still fits", () => {
    const field = FIELDS.desktop;
    const names = [nameBox("a", 480, 270, "Mari", 18)];
    const blocks: BlockSpec[] = [{ id: "a", variants: [{ w: 200, h: 44, keep: 1 }] }];
    const first = layoutCaptions({ field, names, blocks })["a"]!;
    const sticky = layoutCaptions({ field, names, blocks, prefer: { a: "above:0:1" } })["a"]!;
    expect(first.key.startsWith("below")).toBe(true);
    expect(sticky.key).toBe("above:0:1");
  });

  it("places active speakers first so they keep the best spot", () => {
    const field = { w: 400, h: 200 };
    const names = [nameBox("a", 200, 80, "A", 18), nameBox("b", 200, 80, "B", 18)];
    const v = [{ w: 300, h: 60, keep: 1 }];
    const out = layoutCaptions({ field, names, blocks: [{ id: "b", variants: v }, { id: "a", variants: v }] });
    expect(out["b"]?.key.startsWith("below")).toBe(true);
  });
});

describe("captionVariants", () => {
  it("offers the full block first, then narrower, then fewer sentences", () => {
    const v = captionVariants(TEXTS.slice(2, 5), 288);
    expect(v[0]!.keep).toBe(3);
    expect(v.at(-1)!.keep).toBe(1);
    expect(v.every((x) => x.w <= 288)).toBe(true);
  });
});
