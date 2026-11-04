import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpeechSource, liveRequested, type SpeechEvent } from "@/lib/speech";
import { DemoSpeechSource } from "@/lib/speech/demo-source";
import { LiveSpeechSource, parseLiveMessage } from "@/lib/speech/live-source";
import type { SourceProblem } from "@/lib/speech";
import type { AudioCapture } from "@/lib/speech/mic-capture";
import { Resampler } from "@/lib/speech/pcm";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
  }
}

class FakeCapture implements AudioCapture {
  starts = 0;
  stops = 0;
  fail: Error | undefined;
  push: (pcm: Int16Array) => void = () => {};
  async start(onPcm: (pcm: Int16Array) => void) {
    this.starts++;
    if (this.fail) throw this.fail;
    this.push = onPcm;
  }
  stop() {
    this.stops++;
  }
}

const final = (speaker: string, text: string) => JSON.stringify({ type: "final", speaker, text, t: 1000, lag: 0.5 });

describe("Resampler", () => {
  it("averages every three samples of 48 kHz audio into one 16 kHz sample", () => {
    const out = new Resampler(48000).process(new Float32Array([0.3, 0.6, 0.9, -0.3, -0.6, -0.9]));
    expect(Array.from(out)).toEqual([Math.round(0.6 * 32767), Math.round(-0.6 * 32768)]);
  });

  it("gives the same samples however the input is cut into chunks", () => {
    const input = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 7));
    const whole = new Resampler(44100).process(input);
    const parts = new Resampler(44100);
    const pieces = [input.slice(0, 1), input.slice(1, 1000), input.slice(1000, 1001), input.slice(1001)].map((p) => parts.process(p));
    const joined = Int16Array.from(pieces.flatMap((p) => Array.from(p)));
    expect(joined.length).toBe(whole.length);
    expect(whole.length).toBe(1600);
    expect(Array.from(joined)).toEqual(Array.from(whole));
  });

  it("clips instead of wrapping and rejects rates below 16 kHz", () => {
    expect(Array.from(new Resampler(16000).process(new Float32Array([2, -2])))).toEqual([32767, -32768]);
    expect(() => new Resampler(8000)).toThrow(RangeError);
  });
});

describe("parseLiveMessage", () => {
  it("turns a final sentence into a speech event", () => {
    expect(parseLiveMessage(final("B", " Tere. "))).toMatchObject({ speakerId: "B", speakerName: "Kõneleja B", text: "Tere.", isFinal: true });
  });

  it("shows the name a roster server sends instead of Kõneleja <label>", () => {
    const message = JSON.stringify({ type: "final", speaker: "Mari", name: "Mari", text: "Tere.", score: 0.6 });
    expect(parseLiveMessage(message)).toMatchObject({ speakerId: "Mari", speakerName: "Mari" });
    expect(parseLiveMessage(JSON.stringify({ type: "final", speaker: "Tundmatu", name: "Tundmatu", text: "Tere." }))).toMatchObject({ speakerName: "Tundmatu" });
    expect(parseLiveMessage(JSON.stringify({ type: "final", speaker: "A", name: "  ", text: "Tere." }))).toMatchObject({ speakerName: "Kõneleja A" });
  });

  it("ignores other messages, damaged JSON and empty text", () => {
    expect(parseLiveMessage(JSON.stringify({ type: "partial", speaker: "A", text: "x" }))).toBeNull();
    expect(parseLiveMessage("{not json")).toBeNull();
    expect(parseLiveMessage(final("A", "  "))).toBeNull();
    expect(parseLiveMessage(final("", "x"))).toBeNull();
    expect(parseLiveMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe("LiveSpeechSource", () => {
  let capture: FakeCapture;

  beforeEach(() => {
    FakeSocket.instances = [];
    capture = new FakeCapture();
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the connection and microphone on start, only once", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    source.start();
    source.start();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]!.url).toBe("ws://x");
    expect(capture.starts).toBe(1);
  });

  it("sends microphone audio once the connection is open", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    source.start();
    const socket = FakeSocket.instances[0]!;
    capture.push(new Int16Array([1]));
    expect(socket.sent).toHaveLength(0);
    socket.open();
    const pcm = new Int16Array([1, 2, 3]);
    capture.push(pcm);
    expect(socket.sent).toEqual([pcm]);
  });

  it("delivers the sentences the server sends to listeners", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    const seen: SpeechEvent[] = [];
    source.subscribe((e) => seen.push(e));
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.onmessage?.({ data: final("A", "Tere.") });
    socket.onmessage?.({ data: "garbage" });
    expect(seen.map((e) => e.text)).toEqual(["Tere."]);
  });

  it("closes both on stop and starts a new connection on the next start", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    const seen: SpeechEvent[] = [];
    source.subscribe((e) => seen.push(e));
    source.start();
    const first = FakeSocket.instances[0]!;
    source.stop();
    expect(first.closed).toBe(true);
    expect(capture.stops).toBeGreaterThan(0);
    first.onmessage?.({ data: final("A", "late") });
    expect(seen).toEqual([]);
    source.start();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("closes the connection when the microphone is refused", async () => {
    capture.fail = new Error("denied");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const source = new LiveSpeechSource("ws://x", capture);
    source.start();
    await vi.waitFor(() => expect(FakeSocket.instances[0]!.closed).toBe(true));
    source.start(); // can be tried again
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("sends the access key first, then the audio", () => {
    const source = new LiveSpeechSource("ws://x", capture, "secret");
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.onopen?.();
    const pcm = new Int16Array([1, 2]);
    capture.push(pcm);
    expect(socket.sent).toEqual([JSON.stringify({ type: "hello", key: "secret" }), pcm]);
  });

  it("sends the access key before the first audio even when no open event was seen", () => {
    const source = new LiveSpeechSource("ws://x", capture, "secret");
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    capture.push(new Int16Array([1]));
    expect(socket.sent[0]).toBe(JSON.stringify({ type: "hello", key: "secret" }));
  });

  it("sends no hello without a key", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.onopen?.();
    expect(socket.sent).toEqual([]);
  });

  it("stops listening for events after unsubscribe", () => {
    const source = new LiveSpeechSource("ws://x", capture);
    const seen: SpeechEvent[] = [];
    const off = source.subscribe((e) => seen.push(e));
    source.start();
    off();
    FakeSocket.instances[0]!.onmessage?.({ data: final("A", "x") });
    expect(seen).toEqual([]);
  });
});

describe("LiveSpeechSource problems", () => {
  let capture: FakeCapture;
  let problems: (SourceProblem | null)[];
  let source: LiveSpeechSource;

  beforeEach(() => {
    FakeSocket.instances = [];
    capture = new FakeCapture();
    problems = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    source = new LiveSpeechSource("ws://x", capture);
    source.subscribeProblems((p) => problems.push(p));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports a refused microphone and closes the connection", async () => {
    capture.fail = new Error("denied");
    vi.spyOn(console, "error").mockImplementation(() => {});
    source.start();
    await vi.waitFor(() => expect(problems).toEqual(["mic"]));
    expect(FakeSocket.instances[0]!.closed).toBe(true);
  });

  it("reports a server that cannot be reached", () => {
    source.start();
    FakeSocket.instances[0]!.onerror?.();
    expect(problems).toEqual(["unreachable"]);
  });

  it("reports a lost connection and lets go of the microphone", () => {
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.onopen?.();
    const stopsBefore = capture.stops;
    socket.onclose?.({ code: 1006 });
    expect(problems).toEqual(["connection"]);
    expect(capture.stops).toBeGreaterThan(stopsBefore);
  });

  it("tells a wrong key and a full server apart from a lost connection", () => {
    source.start();
    const first = FakeSocket.instances[0]!;
    first.open();
    first.onopen?.();
    first.onclose?.({ code: 4401 });
    source.retry();
    const second = FakeSocket.instances[1]!;
    second.open();
    second.onopen?.();
    second.onclose?.({ code: 1013 });
    expect(problems).toEqual(["refused", null, "busy"]);
  });

  it("starts over on retry and clears the problem when stopped", () => {
    source.start();
    FakeSocket.instances[0]!.onerror?.();
    source.retry();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(problems).toEqual(["unreachable", null]);
    source.stop();
    expect(problems).toEqual(["unreachable", null]);
  });

  it("reports a microphone that only delivers silence, and clears it when sound returns", () => {
    source.start();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    for (let i = 0; i < 29; i++) capture.push(new Int16Array(1600));
    expect(problems).toEqual([]);
    capture.push(new Int16Array(1600));
    expect(problems).toEqual(["no-audio"]);
    capture.push(new Int16Array([0, 0, 5]));
    expect(problems).toEqual(["no-audio", null]);
  });

  it("does not call a quiet but live microphone silent", () => {
    source.start();
    FakeSocket.instances[0]!.open();
    for (let i = 0; i < 100; i++) capture.push(Int16Array.from({ length: 1600 }, (_, k) => (k === 0 ? 1 : 0)));
    expect(problems).toEqual([]);
  });
});

describe("a page built for a live server", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    vi.unstubAllEnvs();
  });

  it("is the microphone by default, also on /vali without ?live", () => {
    vi.stubEnv("VITE_LIVE_URL", "wss://live.example.invalid");
    window.history.pushState({}, "", "/vali");
    expect(liveRequested()).toBe(true);
    expect(createSpeechSource()).toBeInstanceOf(LiveSpeechSource);
  });

  it("never shows the made-up conversation in the field, not even with ?demo", () => {
    vi.stubEnv("VITE_LIVE_URL", "wss://live.example.invalid");
    window.history.pushState({}, "", "/vali?demo");
    expect(liveRequested()).toBe(true);
    expect(createSpeechSource()).toBeInstanceOf(LiveSpeechSource);
  });

  it("is still the demo when the page was not built for a live server", () => {
    window.history.pushState({}, "", "/vali");
    expect(liveRequested()).toBe(false);
  });
});

describe("createSpeechSource with ?live", () => {
  afterEach(() => window.history.pushState({}, "", "/"));

  it("is the microphone only when ?live is in the address", () => {
    expect(liveRequested()).toBe(false);
    expect(createSpeechSource()).toBeInstanceOf(DemoSpeechSource);
    window.history.pushState({}, "", "/vali?live");
    expect(liveRequested()).toBe(true);
    expect(createSpeechSource()).toBeInstanceOf(LiveSpeechSource);
  });

  it("takes the access key from the address fragment only, never from the query", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/speech");
    window.history.pushState({}, "", "/vali?live&key=nope");
    expect((fresh.createSpeechSource() as unknown as { key?: string }).key).toBeUndefined();
    window.history.pushState({}, "", "/vali?live&key=nope#key=abc123");
    expect((fresh.createSpeechSource() as unknown as { key?: string }).key).toBe("abc123");
  });

  it("keeps the key after the address has lost it (moving to another page, starting a new session)", async () => {
    vi.stubEnv("VITE_LIVE_URL", "wss://live.example.invalid"); // a hosted page is live on every address, with or without ?live
    vi.resetModules();
    const fresh = await import("@/lib/speech");
    window.history.pushState({}, "", "/vali#key=abc123");
    expect((fresh.createSpeechSource() as unknown as { key?: string }).key).toBe("abc123");
    window.history.pushState({}, "", "/transkript");
    expect((fresh.createSpeechSource() as unknown as { key?: string }).key).toBe("abc123");
    vi.unstubAllEnvs();
  });

  it("never takes the server address from the address bar", () => {
    window.history.pushState({}, "", "/vali?live&server=wss://evil.example");
    const source = createSpeechSource() as unknown as { url: string };
    expect(source.url).not.toContain("evil");
  });
});
