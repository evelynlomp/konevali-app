import { describe, expect, it } from "vitest";

import { ACTIVE_MS, activityOf, captionFade, MARKER_MS, RECENT_MS, recentLines } from "@/lib/presence";
import type { Utterance } from "@/lib/session-store";

const at = (age: number, now = 1_000_000) => now - age;
const NOW = 1_000_000;

describe("activityOf", () => {
  it("highlights someone who just spoke", () => {
    expect(activityOf(at(0), NOW)).toMatchObject({ state: "active", presence: 1 });
    expect(activityOf(at(ACTIVE_MS), NOW).state).toBe("active");
  });

  it("tones down recent speakers, monotonically", () => {
    const a = activityOf(at(ACTIVE_MS + 1_000), NOW);
    const b = activityOf(at(RECENT_MS - 1_000), NOW);
    expect(a.state).toBe("recent");
    expect(b.state).toBe("recent");
    expect(a.presence).toBeLessThan(1);
    expect(b.presence).toBeLessThan(a.presence);
  });

  it("settles into a quiet name, then a minimal marker after a long silence", () => {
    expect(activityOf(at(RECENT_MS + 1_000), NOW).state).toBe("quiet");
    expect(activityOf(at(MARKER_MS), NOW).state).toBe("quiet");
    expect(activityOf(at(MARKER_MS + 1_000), NOW)).toMatchObject({ state: "marker", presence: 0 });
  });

  it("treats someone who has not spoken yet as quiet, not a marker", () => {
    expect(activityOf(undefined, NOW)).toMatchObject({ state: "quiet", neverSpoke: true });
  });

  it("never goes negative when the clock is slightly behind", () => {
    expect(activityOf(NOW + 500, NOW).state).toBe("active");
  });
});

describe("captionFade", () => {
  it("is full, then fades to nothing by the time the speaker is no longer recent", () => {
    expect(captionFade(0)).toBe(1);
    expect(captionFade(RECENT_MS)).toBe(0);
    expect(captionFade(18_000)).toBeGreaterThan(0);
    expect(captionFade(18_000)).toBeLessThan(1);
  });
});

describe("recentLines", () => {
  const u = (id: string, speakerId: string, age: number): Utterance => ({ id, speakerId, text: id, time: "", at: at(age), turn: id });

  it("returns each speaker's young sentences newest first and drops old speech", () => {
    const list = [u("old", "a", RECENT_MS + 5_000), u("a1", "a", 10_000), u("b1", "b", 5_000), u("a2", "a", 1_000)];
    const m = recentLines(list, NOW);
    expect(m.get("a")!.map((x) => x.id)).toEqual(["a2", "a1"]);
    expect(m.get("b")!.map((x) => x.id)).toEqual(["b1"]);
  });
});
