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

/** A page built for a live server (VITE_LIVE_URL was set when it was built) is a real session, not the example. */
export function builtForLiveServer(): boolean {
  const url = import.meta.env["VITE_LIVE_URL"];
  return typeof url === "string" && url.length > 0;
}

/**
 * Listens to the microphone instead of playing the demo (a replay name wins over it). `?live` in the address asks for
 * it; a page built for a live server always does it: the field never shows the made-up conversation there.
 */
export function liveRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("live") || builtForLiveServer();
}

let rememberedKey: string | undefined;

/**
 * The access key of a private server, taken from the address fragment (`/vali#key=...`). A fragment is never sent to
 * any server in a request, so the key does not end up in the hosting logs. Moving between the pages of the app drops
 * the fragment from the address, so the key is kept in memory (this tab only, not stored anywhere) for as long as the
 * page is open: a new session started later still has it. A reload needs the link with the key again.
 */
export function liveKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const key = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key")?.trim();
  if (key && key.length <= 200) rememberedKey = key;
  return rememberedKey;
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
