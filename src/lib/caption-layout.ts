/*
 * Caption layout engine: places each speaker's caption block in the field so
 * that it never overlaps another caption or any participant's name, and stays
 * inside the field. Pure (no DOM) so it can be tested on its own.
 *
 * Blocks are placed in priority order. Each block offers variants (full text,
 * narrower, fewer lines); the first variant that fits anywhere is used, and a
 * block that fits nowhere is left out rather than drawn over something.
 */

export interface Rect { x: number; y: number; w: number; h: number }

/** A participant's name (or marker) as an obstacle. cx/cy is its centre in px. */
export interface NameBox { id: string; cx: number; cy: number; w: number; h: number }

/** One way to draw a block; `keep` = how many of the newest sentences it shows. */
export interface Variant { w: number; h: number; keep: number; /** font scale, 1 unless the block is shrunk to fit */ scale?: number }

/** Ordered by priority: earlier blocks get first pick of the space. */
export interface BlockSpec { id: string; variants: Variant[] }

export interface Placement extends Rect {
  id: string;
  keep: number;
  scale: number;
  /** "side:shift:gap" — passed back as `prefer` next time to keep blocks from hopping. */
  key: string;
}

export const MARGIN = 6;
export const GAP = 10;
const PAD = 4;
const STICKY_BONUS = 25;

const SHIFTS = [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1];
const GAP_STEPS = [1, 3, 6];
const SIDE_COST: Record<string, number> = { below: 0, above: 6, right: 18, left: 18 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + PAD && b.x < a.x + a.w + PAD && a.y < b.y + b.h + PAD && b.y < a.y + a.h + PAD;

function* candidates(n: NameBox, v: Variant, field: { w: number; h: number }, prefer?: string) {
  const maxX = field.w - v.w - MARGIN, maxY = field.h - v.h - MARGIN;
  for (const step of GAP_STEPS) {
    const gap = GAP * step;
    for (const side of ["below", "above", "right", "left"] as const) {
      for (const s of SHIFTS) {
        let x: number, y: number;
        if (side === "below" || side === "above") {
          x = n.cx - v.w / 2 + s * v.w;
          y = side === "below" ? n.cy + n.h / 2 + gap : n.cy - n.h / 2 - gap - v.h;
        } else {
          x = side === "right" ? n.cx + n.w / 2 + gap : n.cx - n.w / 2 - gap - v.w;
          y = n.cy - v.h / 2 + s * v.h;
        }
        const rect = { x: clamp(x, MARGIN, maxX), y: clamp(y, MARGIN, maxY), w: v.w, h: v.h };
        const key = `${side}:${s}:${step}`;
        const dist = Math.hypot(rect.x + rect.w / 2 - n.cx, rect.y + rect.h / 2 - n.cy);
        const cost = dist + SIDE_COST[side]! + Math.abs(s) * 8 + (step - 1) * 14 - (key === prefer ? STICKY_BONUS : 0);
        yield { rect, key, cost };
      }
    }
  }
}

/** Last resort: the nearest free spot within reach of the name, found by scanning a coarse grid. */
const ROAM_STEP = 12;
const ROAM_RADIUS = 220;
function* roaming(n: NameBox, v: Variant, field: { w: number; h: number }) {
  const maxX = field.w - v.w - MARGIN, maxY = field.h - v.h - MARGIN;
  for (let x = MARGIN; x <= maxX; x += ROAM_STEP) {
    for (let y = MARGIN; y <= maxY; y += ROAM_STEP) {
      const dist = Math.hypot(x + v.w / 2 - n.cx, y + v.h / 2 - n.cy);
      if (dist > ROAM_RADIUS + v.w / 2) continue;
      yield { rect: { x, y, w: v.w, h: v.h }, key: "roam", cost: 100 + dist };
    }
  }
}

interface Found { index: number; rect: Rect; key: string }

/** First variant (in listed order, among `indices`) that has a free spot; `roam` widens the search. */
function find(block: BlockSpec, name: NameBox, taken: Rect[], field: { w: number; h: number }, indices: number[], roam: boolean, prefer?: string): Found | undefined {
  for (const index of indices) {
    const v = block.variants[index]!;
    if (v.w > field.w - 2 * MARGIN || v.h > field.h - 2 * MARGIN) continue;
    let best: { rect: Rect; key: string; cost: number } | undefined;
    for (const c of roam ? roaming(name, v, field) : candidates(name, v, field, prefer)) {
      if (best && c.cost >= best.cost) continue;
      if (taken.some((t) => overlaps(c.rect, t))) continue;
      best = c;
    }
    if (best) return { index, rect: best.rect, key: best.key };
  }
  return undefined;
}

/**
 * Two passes. First every speaker gets their newest sentence, in priority order,
 * so a long block of one speaker cannot crowd out another's latest words. Then,
 * again in priority order, blocks grow to more sentences wherever room is left.
 */
export function layoutCaptions(opts: {
  field: { w: number; h: number };
  names: NameBox[];
  blocks: BlockSpec[];
  prefer?: Record<string, string>;
}): Record<string, Placement | null> {
  const { field, names, blocks, prefer = {} } = opts;
  const nameRects: Rect[] = names.map((n) => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h }));
  const byId = new Map(names.map((n) => [n.id, n]));
  const placed = new Map<string, Found>();
  const takenExcept = (id?: string) => [...nameRects, ...[...placed].filter(([k]) => k !== id).map(([, f]) => f.rect)];

  // pass 1: the newest sentence only (the variants with the fewest sentences)
  for (const block of blocks) {
    const name = byId.get(block.id);
    if (!name || !block.variants.length) continue;
    const minKeep = Math.min(...block.variants.map((v) => v.keep));
    const indices = block.variants.flatMap((v, i) => (v.keep === minKeep ? [i] : []));
    const found = find(block, name, takenExcept(), field, indices, false, prefer[block.id]) ?? find(block, name, takenExcept(), field, indices, true);
    if (found) placed.set(block.id, found);
  }

  // pass 2: upgrade to richer variants next to the name where there is room
  for (const block of blocks) {
    const current = placed.get(block.id);
    const name = byId.get(block.id);
    if (!current || !name) continue;
    const better = Array.from({ length: current.index }, (_, i) => i);
    const found = find(block, name, takenExcept(block.id), field, better, false, prefer[block.id]);
    if (found) placed.set(block.id, found);
  }

  const out: Record<string, Placement | null> = {};
  for (const block of blocks) {
    const f = placed.get(block.id);
    out[block.id] = f ? { ...f.rect, id: block.id, keep: block.variants[f.index]!.keep, scale: block.variants[f.index]!.scale ?? 1, key: f.key } : null;
  }
  return out;
}

/* ── size estimates (no DOM access, deliberately a little generous) ──
 * All take `rem`, the page's root font size in px, so boxes follow the reader's text size. */

export const CAPTION_ITEM_GAP = 4;
/** Caption line height is 1.375 × the font size (leading-snug). */
export const captionLinePx = (rem: number) => Math.round(rem * 1.375);
/** Average glyph width for the caption face; high on purpose so boxes err large. */
const charPx = (rem: number) => rem * 0.58;
/** The newest sentence may use more lines than the older ones, as before. */
export const MAX_LINES = { newest: 6, older: 2 };

/** Lines `text` needs at `width` px (greedy word wrap; multi-line wraps assume 10% ragged-edge loss). */
export function wrapLines(text: string, width: number, rem = 16): number {
  if (text.length * charPx(rem) <= width) return 1;
  const maxChars = Math.max(1, Math.floor((0.9 * width) / charPx(rem)));
  let lines = 1, cur = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur === 0) cur = word.length;
    else if (cur + 1 + word.length <= maxChars) cur += 1 + word.length;
    else { lines++; cur = word.length; }
    while (cur > maxChars) { lines++; cur -= maxChars; }
  }
  return lines;
}

/** Lines the renderer shows for sentence `index` (0 = newest) at `width` px. */
export const shownLines = (text: string, index: number, width: number, rem = 16) =>
  Math.min(index === 0 ? MAX_LINES.newest : MAX_LINES.older, wrapLines(text, width, rem));

function measure(texts: string[], width: number, rem: number): { w: number; h: number } {
  let h = 0, natural = 0;
  texts.forEach((t, i) => {
    h += shownLines(t, i, width, rem) * captionLinePx(rem);
    natural = Math.max(natural, Math.min(width, t.length * charPx(rem)));
  });
  h += Math.max(0, texts.length - 1) * CAPTION_ITEM_GAP;
  return { w: Math.min(width, Math.ceil(natural) + 8), h };
}

/** Smaller type is the last thing a crowded field gives up, after narrower and shorter blocks. */
export const FIT_SCALES = [1, 0.85];

/**
 * Variants for a block, best first: all sentences at full size and width, then
 * narrower, then smaller type, then dropping the oldest sentences. `texts` is newest first.
 */
export function captionVariants(texts: string[], maxWidth: number, rem = 16): Variant[] {
  const out: Variant[] = [];
  for (let keep = texts.length; keep >= 1; keep--) {
    for (const scale of FIT_SCALES) {
      for (const width of [maxWidth, Math.round(maxWidth * 0.7), Math.round(maxWidth * 0.5)]) {
        // A narrower block must never cut off the newest sentence; only the full width may.
        if (width !== maxWidth && wrapLines(texts[0]!, width, rem * scale) > MAX_LINES.newest) continue;
        const m = measure(texts.slice(0, keep), width, rem * scale);
        if (!out.some((o) => o.keep === keep && o.scale === scale && o.w === m.w && o.h === m.h)) out.push({ ...m, keep, scale });
      }
    }
  }
  return out;
}

/** Obstacle for a name label of `fontPx`, or a fixed marker. */
export function nameBox(id: string, cx: number, cy: number, label: string, fontPx: number, opts: { marker?: boolean; underline?: boolean } = {}): NameBox {
  if (opts.marker) return { id, cx, cy, w: 28, h: 28 };
  return { id, cx, cy, w: Math.ceil(label.length * fontPx * 0.62) + 20, h: Math.ceil(fontPx * 1.6) + (opts.underline ? 8 : 4) };
}
