import { DemoSpeechSource } from "./demo-source";
import { ReplaySpeechSource } from "./replay-source";
import type { SpeechSource } from "./types";

export type { SpeechEvent, SpeechListener, SpeechSource } from "./types";

/**
 * `?replay=<name>` in the address bar plays public/replay/<name>.json instead of the demo.
 * Only plain names are accepted, so the address bar cannot point the app at any other URL.
 */
export function replayName(): string | null {
  if (typeof window === "undefined") return null;
  const name = new URLSearchParams(window.location.search).get("replay");
  return name && /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
}

/** The one place that decides which speech source the app uses. */
export function createSpeechSource(): SpeechSource {
  const replay = replayName();
  return replay ? new ReplaySpeechSource(`/replay/${replay}.json`) : new DemoSpeechSource();
}
