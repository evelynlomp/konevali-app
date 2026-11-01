import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpeechSource, liveRequested, type SpeechEvent } from "@/lib/speech";
import { DemoSpeechSource } from "@/lib/speech/demo-source";
import { LiveSpeechSource, parseLiveMessage } from "@/lib/speech/live-source";
import type { AudioCapture } from "@/lib/speech/mic-capture";
import { Resampler } from "@/lib/speech/pcm";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "";
  sent: unknown[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
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

describe("createSpeechSource with ?live", () => {
  afterEach(() => window.history.pushState({}, "", "/"));

  it("is the microphone only when ?live is in the address", () => {
    expect(liveRequested()).toBe(false);
    expect(createSpeechSource()).toBeInstanceOf(DemoSpeechSource);
    window.history.pushState({}, "", "/vali?live");
    expect(liveRequested()).toBe(true);
    expect(createSpeechSource()).toBeInstanceOf(LiveSpeechSource);
  });

  it("never takes the server address from the address bar", () => {
    window.history.pushState({}, "", "/vali?live&server=wss://evil.example");
    const source = createSpeechSource() as unknown as { url: string };
    expect(source.url).not.toContain("evil");
  });
});
