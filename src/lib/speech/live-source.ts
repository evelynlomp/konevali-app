import { MicCapture, type AudioCapture } from "./mic-capture";
import type {
  EnrollFailure,
  EnrollResult,
  NamesControl,
  NamesState,
  ProblemListener,
  SourceProblem,
  SpeechEvent,
  SpeechListener,
  SpeechSource,
} from "./types";

/** What the live server sends for each finished sentence. Other message types and extra fields are ignored. */
export function parseLiveMessage(data: unknown): SpeechEvent | null {
  if (typeof data !== "string") return null;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  const { type, speaker, text, name } = message ?? {};
  if (type !== "final" || typeof speaker !== "string" || !speaker.trim() || typeof text !== "string" || !text.trim()) return null;
  return {
    speakerId: speaker.trim(),
    // the server sends a name only for "Tundmatu"; a voice print belongs to an id the page itself chose
    speakerName: typeof name === "string" && name.trim() ? name.trim() : `Kõneleja ${speaker.trim()}`,
    text: text.trim(),
    timestamp: Date.now(),
    isFinal: true,
  };
}

/** The server's other messages: what it can do, the names state, the result of a voice sample. */
export type ControlMessage =
  | { type: "ready"; names: boolean }
  | { type: "names"; on: boolean; ids: string[] }
  | { type: "enroll"; id: string; result: EnrollResult };

const ENROLL_FAILURES: EnrollFailure[] = ["too_little", "inconsistent", "limit", "bad_id", "unavailable"];

export function parseControlMessage(data: unknown): ControlMessage | null {
  if (typeof data !== "string") return null;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  switch (message?.["type"]) {
    case "ready":
      return { type: "ready", names: message["names"] === true };
    case "names": {
      const ids = message["ids"];
      return { type: "names", on: message["on"] === true, ids: Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : [] };
    }
    case "enroll": {
      const id = typeof message["id"] === "string" ? message["id"] : "";
      if (message["ok"] === true) return { type: "enroll", id, result: { ok: true, seconds: typeof message["seconds"] === "number" ? message["seconds"] : 0 } };
      const reason = ENROLL_FAILURES.find((r) => r === message["reason"]) ?? "unavailable";
      return { type: "enroll", id, result: { ok: false, reason } };
    }
    default:
      return null;
  }
}

/** The server closes with these codes (tools/live-server.py). */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BUSY = 1013;
/** This much exact digital silence in a row means the audio does not arrive (a real microphone always has some noise). */
const NO_AUDIO_SAMPLES = 16000 * 3;
/** A voice sample the server does not answer within this time counts as failed. */
const ENROLL_ANSWER_MS = 20000;

const NO_NAMES: NamesState = { known: false, available: false, on: false, ids: [], enrolling: null };

/**
 * Listens to the room through the microphone: the audio goes to the live ASR server over a WebSocket and the
 * finished sentences come back. start() opens the microphone and the connection, stop() closes both; a later
 * start() begins a new connection (the server's speaker labels start over).
 *
 * Problems (no microphone, no audio, no server, lost connection, no free place, wrong key) are reported through
 * subscribeProblems() so the page can say so. There is no automatic reconnecting: retry() starts over on request.
 * When the connection is lost the microphone is released as well.
 *
 * Names (`names`): a server that can recognise voices keeps a voice print per person in the memory of this
 * connection only. Closing the connection, turning names off or removing a person deletes the print. The page never
 * receives a print, only the ids of the people who have one.
 */
export class LiveSpeechSource implements SpeechSource {
  readonly requiresConsent = true;

  private listeners = new Set<SpeechListener>();
  private problemListeners = new Set<ProblemListener>();
  private socket?: WebSocket | undefined;
  private running = false;
  private problem: SourceProblem | null = null;
  private silentSamples = 0;

  private namesState: NamesState = NO_NAMES;
  private nameListeners = new Set<() => void>();
  private enrollWaiter?: { id: string; settle: (result: EnrollResult) => void } | undefined;

  readonly names: NamesControl = {
    state: () => this.namesState,
    subscribe: (listener) => {
      this.nameListeners.add(listener);
      return () => {
        this.nameListeners.delete(listener);
      };
    },
    setNames: (on) => {
      this.sendJson({ type: "names", on });
    },
    enrollStart: (id) => {
      if (!this.namesState.on || this.namesState.enrolling !== null || !this.sendJson({ type: "enroll_start", id })) return false;
      this.setNames({ enrolling: id });
      return true;
    },
    enrollFinish: (id) =>
      new Promise<EnrollResult>((resolve) => {
        if (this.namesState.enrolling !== id || !this.sendJson({ type: "enroll_end", id })) {
          this.setNames({ enrolling: null });
          return resolve({ ok: false, reason: "unavailable" });
        }
        const timer = setTimeout(() => this.settleEnroll({ ok: false, reason: "unavailable" }), ENROLL_ANSWER_MS);
        this.enrollWaiter = {
          id,
          settle: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
        };
      }),
    enrollCancel: () => {
      if (this.namesState.enrolling === null) return;
      this.sendJson({ type: "enroll_cancel" });
      this.setNames({ enrolling: null });
    },
    removeProfile: (id) => {
      this.sendJson({ type: "remove", id });
    },
  };

  constructor(
    private readonly url: string,
    private readonly capture: AudioCapture = new MicCapture(),
    private readonly key?: string,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.silentSamples = 0;
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    let opened = false;
    let greeted = false;
    // a server with an access key wants {"type": "hello", "key": ...} before anything else
    const greet = () => {
      if (greeted) return;
      greeted = true;
      if (this.key) socket.send(JSON.stringify({ type: "hello", key: this.key }));
    };
    socket.onopen = () => {
      opened = true;
      greet();
    };
    socket.onmessage = (e) => {
      const control = parseControlMessage(e.data);
      if (control) return this.onControl(control);
      const event = parseLiveMessage(e.data);
      if (event) this.listeners.forEach((l) => l(event));
    };
    socket.onclose = (e) => {
      if (this.socket !== socket || !this.running) return;
      const code = (e as { code?: number } | undefined)?.code;
      this.fail(code === CLOSE_UNAUTHORIZED ? "refused" : code === CLOSE_BUSY ? "busy" : opened ? "connection" : "unreachable");
    };
    socket.onerror = () => {
      if (this.socket === socket && this.running && !opened) this.fail("unreachable");
    };
    this.socket = socket;
    this.capture
      .start((pcm) => {
        this.watch(pcm);
        // audio before the connection opens is dropped; a few hundred milliseconds of silence at the start do not matter
        if (socket.readyState !== WebSocket.OPEN) return;
        greet();
        socket.send(pcm);
      })
      .catch((error) => {
        console.error("Mikrofoni ei saanud avada", error);
        if (this.socket === socket) this.fail("mic");
      });
  }

  stop() {
    this.shutdown();
    this.setProblem(null);
  }

  /** Starts over after a problem. */
  retry() {
    this.stop();
    this.start();
  }

  subscribe(listener: SpeechListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeProblems(listener: ProblemListener) {
    this.problemListeners.add(listener);
    return () => {
      this.problemListeners.delete(listener);
    };
  }

  /** Closes the microphone and the connection without touching the reported problem. The server drops every voice print with it. */
  private shutdown() {
    this.running = false;
    this.capture.stop();
    const socket = this.socket;
    this.socket = undefined;
    this.settleEnroll({ ok: false, reason: "unavailable" });
    this.setNames(NO_NAMES);
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }

  private fail(problem: SourceProblem) {
    this.shutdown();
    this.setProblem(problem);
  }

  private setProblem(problem: SourceProblem | null) {
    if (problem === this.problem) return;
    this.problem = problem;
    this.problemListeners.forEach((l) => l(problem));
  }

  private setNames(patch: Partial<NamesState>) {
    this.namesState = { ...this.namesState, ...patch };
    this.nameListeners.forEach((l) => l());
  }

  private sendJson(message: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private settleEnroll(result: EnrollResult) {
    const waiter = this.enrollWaiter;
    this.enrollWaiter = undefined;
    waiter?.settle(result);
  }

  private onControl(message: ControlMessage) {
    if (message.type === "ready") this.setNames({ known: true, available: message.names });
    else if (message.type === "names") this.setNames({ on: message.on, ids: message.ids, ...(message.on ? {} : { enrolling: null }) });
    else if (this.enrollWaiter?.id === message.id) {
      this.setNames({ enrolling: null });
      this.settleEnroll(message.result);
    }
  }

  /** Notices a microphone that is open but delivers nothing but zeros (muted at the device, for example). */
  private watch(pcm: Int16Array) {
    if (pcm.some((v) => v !== 0)) {
      this.silentSamples = 0;
      if (this.problem === "no-audio") this.setProblem(null);
      return;
    }
    this.silentSamples += pcm.length;
    if (this.silentSamples >= NO_AUDIO_SAMPLES && this.problem === null) this.setProblem("no-audio");
  }
}
