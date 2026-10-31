import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpeechSource, replayName, type SpeechEvent } from "@/lib/speech";
import { parseReplay, ReplaySpeechSource } from "@/lib/speech/replay-source";
import { DemoSpeechSource } from "@/lib/speech/demo-source";

const FILE = {
  version: 1,
  names: { A: "Mari" },
  events: [
    { t: 1000, speaker: "A", text: "Tere." },
    { t: 4000, speaker: "B", text: "Tere-tere.", score: 0.7 },
    { t: 6000, speaker: "A", text: "Alustame." },
  ],
};

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })));
}

describe("parseReplay", () => {
  it("keeps valid events in time order and ignores extra fields", () => {
    const r = parseReplay({ events: [{ t: 5, speaker: "B", text: "b", score: 1 }, { t: 1, speaker: "A", text: "a" }] });
    expect(r.events).toEqual([{ t: 1, speaker: "A", text: "a" }, { t: 5, speaker: "B", text: "b" }]);
  });

  it("drops incomplete or malformed events and tolerates junk input", () => {
    const r = parseReplay({
      events: [{ t: "1", speaker: "A", text: "x" }, { t: 1, speaker: "", text: "x" }, { t: 1, speaker: "A", text: " " }, { t: -1, speaker: "A", text: "x" }, null, 5, { t: 2, speaker: "A", text: "ok" }],
    });
    expect(r.events).toEqual([{ t: 2, speaker: "A", text: "ok" }]);
    expect(parseReplay(null).events).toEqual([]);
    expect(parseReplay("nope").events).toEqual([]);
  });

  it("reads display names and ignores non-string ones", () => {
    expect(parseReplay({ events: [], names: { A: "Mari", B: 3, C: " " } }).names).toEqual({ A: "Mari" });
  });
});

describe("ReplaySpeechSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays the events with their gaps, as final speech events with the file's names", async () => {
    stubFetch(FILE);
    const source = new ReplaySpeechSource("/replay/x.json");
    const events: SpeechEvent[] = [];
    source.subscribe((e) => events.push(e));
    source.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ speakerId: "A", speakerName: "Mari", text: "Tere.", timestamp: expect.any(Number), isFinal: true });

    await vi.advanceTimersByTimeAsync(3000); // t = 4000
    expect(events[1]).toMatchObject({ speakerId: "B", speakerName: "Kõneleja B", text: "Tere-tere." });

    await vi.advanceTimersByTimeAsync(2000); // t = 6000
    expect(events.map((e) => e.speakerId)).toEqual(["A", "B", "A"]);
  });

  it("stops after the last event instead of looping", async () => {
    stubFetch(FILE);
    const source = new ReplaySpeechSource("/replay/x.json");
    const listener = vi.fn();
    source.subscribe(listener);
    source.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps its position when paused and carries on with the next event", async () => {
    stubFetch(FILE);
    const source = new ReplaySpeechSource("/replay/x.json");
    const texts: string[] = [];
    source.subscribe((e) => texts.push(e.text));
    source.start();
    await vi.advanceTimersByTimeAsync(1000);
    source.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(texts).toEqual(["Tere."]);

    source.start();
    await vi.advanceTimersByTimeAsync(3000); // the next gap is waited out again
    expect(texts).toEqual(["Tere.", "Tere-tere."]);
  });

  it("does not play twice when started again before the file has loaded", async () => {
    stubFetch(FILE);
    const source = new ReplaySpeechSource("/replay/x.json");
    const listener = vi.fn();
    source.subscribe(listener);
    source.start();
    source.stop();
    source.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does nothing, quietly, when the file cannot be loaded", async () => {
    stubFetch({}, false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const source = new ReplaySpeechSource("/replay/missing.json");
    const listener = vi.fn();
    source.subscribe(listener);
    source.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops delivering to unsubscribed listeners", async () => {
    stubFetch(FILE);
    const source = new ReplaySpeechSource("/replay/x.json");
    const listener = vi.fn();
    source.subscribe(listener)();
    source.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("source choice", () => {
  const at = (search: string) => window.history.replaceState({}, "", `/vali${search}`);
  afterEach(() => at(""));

  it("plays the demo unless ?replay=<name> is given", () => {
    at("");
    expect(replayName()).toBeNull();
    expect(createSpeechSource()).toBeInstanceOf(DemoSpeechSource);
  });

  it("plays public/replay/<name>.json for ?replay=<name>", () => {
    at("?replay=sample");
    expect(replayName()).toBe("sample");
    expect(createSpeechSource()).toBeInstanceOf(ReplaySpeechSource);
  });

  it("only accepts plain names, never paths or URLs", () => {
    for (const bad of ["../secret", "a/b", "http://evil.example/x", "a.json", ""]) {
      at(`?replay=${encodeURIComponent(bad)}`);
      expect(replayName(), bad).toBeNull();
    }
  });
});
