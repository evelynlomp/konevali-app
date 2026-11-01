import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveSpeechSource, parseControlMessage } from "@/lib/speech/live-source";
import type { AudioCapture } from "@/lib/speech/mic-capture";

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
  /** What the page sent as text messages, parsed. */
  json() {
    return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s));
  }
}

class FakeCapture implements AudioCapture {
  async start() {}
  stop() {}
}

const fromServer = (socket: FakeSocket, message: Record<string, unknown>) => socket.onmessage?.({ data: JSON.stringify(message) });

describe("parseControlMessage", () => {
  it("reads what the server can do, the names state and the result of a voice sample", () => {
    expect(parseControlMessage(JSON.stringify({ type: "ready", names: true }))).toEqual({ type: "ready", names: true });
    expect(parseControlMessage(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready", names: false });
    expect(parseControlMessage(JSON.stringify({ type: "names", on: true, ids: ["a", 3, "b"] }))).toEqual({ type: "names", on: true, ids: ["a", "b"] });
    expect(parseControlMessage(JSON.stringify({ type: "enroll", id: "a", ok: true, seconds: 9.5 }))).toEqual({ type: "enroll", id: "a", result: { ok: true, seconds: 9.5 } });
    expect(parseControlMessage(JSON.stringify({ type: "enroll", id: "a", ok: false, reason: "inconsistent" }))).toEqual({
      type: "enroll",
      id: "a",
      result: { ok: false, reason: "inconsistent" },
    });
  });

  it("treats an unknown failure as unavailable and ignores everything else", () => {
    expect(parseControlMessage(JSON.stringify({ type: "enroll", id: "a", ok: false, reason: "???" }))).toMatchObject({ result: { ok: false, reason: "unavailable" } });
    expect(parseControlMessage(JSON.stringify({ type: "final", speaker: "A", text: "x" }))).toBeNull();
    expect(parseControlMessage("{broken")).toBeNull();
    expect(parseControlMessage(new ArrayBuffer(2))).toBeNull();
  });
});

describe("LiveSpeechSource names", () => {
  let source: LiveSpeechSource;
  let socket: FakeSocket;

  const connect = (names = true) => {
    source.start();
    socket = FakeSocket.instances.at(-1)!;
    socket.open();
    fromServer(socket, { type: "ready", names });
  };

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    source = new LiveSpeechSource("ws://x", new FakeCapture());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("knows nothing until the server says what it can do", () => {
    expect(source.names.state()).toEqual({ known: false, available: false, on: false, ids: [], enrolling: null });
    connect();
    expect(source.names.state()).toMatchObject({ known: true, available: true, on: false });
    source.stop();
    connect(false);
    expect(source.names.state()).toMatchObject({ known: true, available: false });
  });

  it("asks the server to turn names on and off, and follows its answer", () => {
    connect();
    const heard = vi.fn();
    source.names.subscribe(heard);
    source.names.setNames(true);
    expect(socket.json()).toEqual([{ type: "names", on: true }]);
    fromServer(socket, { type: "names", on: true, ids: [] });
    expect(source.names.state().on).toBe(true);
    source.names.setNames(false);
    expect(socket.json().at(-1)).toEqual({ type: "names", on: false });
    fromServer(socket, { type: "names", on: false, ids: [] });
    expect(source.names.state()).toMatchObject({ on: false, ids: [] });
    expect(heard).toHaveBeenCalled();
  });

  it("sends nothing while there is no open connection", () => {
    source.names.setNames(true);
    source.names.removeProfile("a");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("starts a voice sample only while names are on, and one at a time", () => {
    connect();
    expect(source.names.enrollStart("a")).toBe(false);
    fromServer(socket, { type: "names", on: true, ids: [] });
    expect(source.names.enrollStart("a")).toBe(true);
    expect(socket.json().at(-1)).toEqual({ type: "enroll_start", id: "a" });
    expect(source.names.state().enrolling).toBe("a");
    expect(source.names.enrollStart("b")).toBe(false);
  });

  it("finishes a sample with the server's answer and learns who has a voice print", async () => {
    connect();
    fromServer(socket, { type: "names", on: true, ids: [] });
    source.names.enrollStart("a");
    const result = source.names.enrollFinish("a");
    expect(socket.json().at(-1)).toEqual({ type: "enroll_end", id: "a" });
    fromServer(socket, { type: "enroll", id: "a", ok: true, seconds: 10 });
    fromServer(socket, { type: "names", on: true, ids: ["a"] });
    await expect(result).resolves.toEqual({ ok: true, seconds: 10 });
    expect(source.names.state()).toMatchObject({ enrolling: null, ids: ["a"] });
  });

  it("passes on why a sample was not accepted", async () => {
    connect();
    fromServer(socket, { type: "names", on: true, ids: [] });
    source.names.enrollStart("a");
    const result = source.names.enrollFinish("a");
    fromServer(socket, { type: "enroll", id: "a", ok: false, reason: "too_little" });
    await expect(result).resolves.toEqual({ ok: false, reason: "too_little" });
    expect(source.names.state().enrolling).toBeNull();
  });

  it("gives up on a sample the server never answers", async () => {
    vi.useFakeTimers();
    connect();
    fromServer(socket, { type: "names", on: true, ids: [] });
    source.names.enrollStart("a");
    const result = source.names.enrollFinish("a");
    await vi.advanceTimersByTimeAsync(20000);
    await expect(result).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("throws a sample away on cancel and asks the server to delete a voice print on remove", () => {
    connect();
    fromServer(socket, { type: "names", on: true, ids: ["a"] });
    source.names.enrollStart("b");
    source.names.enrollCancel();
    expect(socket.json().at(-1)).toEqual({ type: "enroll_cancel" });
    expect(source.names.state().enrolling).toBeNull();
    source.names.removeProfile("a");
    expect(socket.json().at(-1)).toEqual({ type: "remove", id: "a" });
  });

  it("forgets every name when the session ends: stopped or the connection lost", async () => {
    connect();
    fromServer(socket, { type: "names", on: true, ids: ["a"] });
    source.names.enrollStart("b");
    const pending = source.names.enrollFinish("b");
    source.stop();
    await expect(pending).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(source.names.state()).toEqual({ known: false, available: false, on: false, ids: [], enrolling: null });

    FakeSocket.instances = [];
    connect();
    fromServer(socket, { type: "names", on: true, ids: ["a"] });
    socket.onclose?.({ code: 1006 });
    expect(source.names.state()).toMatchObject({ on: false, ids: [] });
  });

  it("drops a sample in progress when the server says names are off", () => {
    connect();
    fromServer(socket, { type: "names", on: true, ids: [] });
    source.names.enrollStart("a");
    fromServer(socket, { type: "names", on: false, ids: [] });
    expect(source.names.state().enrolling).toBeNull();
  });
});
