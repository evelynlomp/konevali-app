import { DemoSpeechSource } from "./demo-source";
import type { SpeechSource } from "./types";

export type { SpeechEvent, SpeechListener, SpeechSource } from "./types";

/** The one place that decides which speech source the app uses. */
export function createSpeechSource(): SpeechSource {
  return new DemoSpeechSource();
}
