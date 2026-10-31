/** One piece of recognised speech, as delivered by any speech source. */
export interface SpeechEvent {
  speakerId: string;
  speakerName: string;
  text: string;
  /** Unix epoch milliseconds when the speech was recognised. */
  timestamp: number;
  /** false = interim hypothesis that may still change; true = settled text. */
  isFinal: boolean;
}

export type SpeechListener = (event: SpeechEvent) => void;

/**
 * Anything that can produce speech events: the scripted demo, a microphone
 * recogniser, a remote ASR service. The conversation field only ever sees this
 * interface, never the concrete source.
 */
export interface SpeechSource {
  /** Begin (or resume) emitting events. Safe to call when already started. */
  start(): void;
  /** Stop emitting events. A later start() resumes where the source left off. */
  stop(): void;
  /** Register a listener; returns the function that removes it. */
  subscribe(listener: SpeechListener): () => void;
}
