import { DemoSpeechSource } from "./demo-source";
import { LiveSpeechSource } from "./live-source";
import { ReplaySpeechSource } from "./replay-source";
import type { SpeechSource } from "./types";

export type {
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

/**
 * `?replay=<name>` in the address bar plays public/replay/<name>.json instead of the demo.
 * Only plain names are accepted, so the address bar cannot point the app at any other URL.
 */
export function replayName(): string | null {
  if (typeof window === "undefined") return null;
  const name = new URLSearchParams(window.location.search).get("replay");
  return name && /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
}

/** `?live` in the address bar listens to the microphone instead of playing the demo (a replay name wins over it). */
export function liveRequested(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("live");
}

/**
 * The access key of a private server, taken from the address fragment (`/vali?live#key=...`). A fragment is never
 * sent to any server in a request, so the key does not end up in the hosting logs.
 */
export function liveKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const key = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key")?.trim();
  return key && key.length <= 200 ? key : undefined;
}

/** What the address asks for: a replay, the microphone, or (by default) the made-up demo. */
export function sourceMode(): "replay" | "live" | "demo" {
  return replayName() ? "replay" : liveRequested() ? "live" : "demo";
}

/**
 * Where the microphone audio goes. Fixed at build time, never taken from the address bar: otherwise a link
 * could send a visitor's voice to any server.
 */
export const LIVE_SERVER_URL: string = import.meta.env["VITE_LIVE_URL"] ?? "ws://localhost:8765";

/** The one place that decides which speech source the app uses. */
export function createSpeechSource(): SpeechSource {
  const replay = replayName();
  if (replay) return new ReplaySpeechSource(`/replay/${replay}.json`);
  return liveRequested() ? new LiveSpeechSource(LIVE_SERVER_URL, undefined, liveKey()) : new DemoSpeechSource();
}
