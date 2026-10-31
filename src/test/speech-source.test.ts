import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, renderHook } from "@testing-library/react";

import { actions, useSession } from "@/lib/session-store";
import { DemoSpeechSource } from "@/lib/speech/demo-source";
import type { SpeechEvent } from "@/lib/speech";

describe("DemoSpeechSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits final events in the agreed shape on its schedule", () => {
    const source = new DemoSpeechSource();
    const events: SpeechEvent[] = [];
    source.subscribe((e) => events.push(e));
    source.start();

    vi.advanceTimersByTime(1200);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      speakerId: "s1",
      speakerName: "Mari",
      text: "Tere tulemast kõigile.",
      timestamp: expect.any(Number),
      isFinal: true,
    });

    vi.advanceTimersByTime(4000);
    expect(events).toHaveLength(2);
  });

  it("stops emitting and resumes where it left off", () => {
    const source = new DemoSpeechSource();
    const texts: string[] = [];
    source.subscribe((e) => texts.push(e.text));

    source.start();
    vi.advanceTimersByTime(1200);
    source.stop();
    vi.advanceTimersByTime(60_000);
    expect(texts).toHaveLength(1);

    source.start();
    vi.advanceTimersByTime(1200);
    expect(texts).toEqual(["Tere tulemast kõigile.", "Alustame eelarve aruteluga."]);
  });

  it("stops delivering to unsubscribed listeners", () => {
    const source = new DemoSpeechSource();
    const listener = vi.fn();
    source.subscribe(listener)();
    source.start();
    vi.advanceTimersByTime(10_000);
    expect(listener).not.toHaveBeenCalled();
    source.stop();
  });
});

describe("actions.ingest", () => {
  const event = (over: Partial<SpeechEvent> = {}): SpeechEvent => ({
    speakerId: "s1", speakerName: "Mari", text: "Tere", timestamp: Date.now(), isFinal: true, ...over,
  });

  it("adds final speech to the transcript and marks the speaker active", () => {
    const { result } = renderHook(() => useSession());
    const before = result.current.utterances.length;
    act(() => actions.ingest(event({ text: "Tere!" })));
    expect(result.current.utterances).toHaveLength(before + 1);
    expect(result.current.utterances.at(-1)).toMatchObject({ speakerId: "s1", text: "Tere!" });
    expect(result.current.activeId).toBe("s1");
  });

  it("creates unknown speakers from the event's name", () => {
    const { result } = renderHook(() => useSession());
    act(() => actions.ingest(event({ speakerId: "ext-9", speakerName: "Kati" })));
    expect(result.current.speakers.find((s) => s.id === "ext-9")?.name).toBe("Kati");
  });

  it("ignores interim events", () => {
    const { result } = renderHook(() => useSession());
    const before = result.current.utterances.length;
    act(() => actions.ingest(event({ isFinal: false })));
    expect(result.current.utterances).toHaveLength(before);
  });

  it("ignores events while paused", () => {
    const { result } = renderHook(() => useSession());
    const before = result.current.utterances.length;
    act(() => actions.toggleRunning());
    act(() => actions.ingest(event()));
    expect(result.current.utterances).toHaveLength(before);
  });
});
