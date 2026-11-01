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
 * Why a live source cannot deliver speech right now. The page says it in plain words; a source that has no such
 * failure modes (the demo, a replay) never reports one.
 */
export type SourceProblem =
  | "mic" // no microphone, or the browser refused it
  | "no-audio" // the microphone is open but only digital silence comes out
  | "unreachable" // the server could not be reached
  | "connection" // an open connection was lost
  | "busy" // the server has no free place
  | "refused"; // the access key is missing or wrong

export type ProblemListener = (problem: SourceProblem | null) => void;

/**
 * Names (a live source whose server can recognise voices). A voice print lives only in the memory of the server's
 * connection; the page only ever knows the ids of the people who have one.
 */
export interface NamesState {
  /** The server has said what it can do (false while connecting). */
  known: boolean;
  /** The server can name voices at all. */
  available: boolean;
  /** Names are turned on for this session. */
  on: boolean;
  /** Who has a voice print on the server. */
  ids: string[];
  /** Whose voice sample is being taken at the moment. */
  enrolling: string | null;
}

export type EnrollFailure = "too_little" | "inconsistent" | "limit" | "bad_id" | "unavailable";
export type EnrollResult = { ok: true; seconds: number } | { ok: false; reason: EnrollFailure };

export interface NamesControl {
  state(): NamesState;
  subscribe(listener: () => void): () => void;
  /** Turning names off deletes every voice print on the server at once. */
  setNames(on: boolean): void;
  /** From now on the microphone audio is this person's voice sample. False if that cannot be started. */
  enrollStart(id: string): boolean;
  /** Ends the sample; resolves with what the server made of it. */
  enrollFinish(id: string): Promise<EnrollResult>;
  enrollCancel(): void;
  /** Deletes one person's voice print. */
  removeProfile(id: string): void;
}

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
  /** Only sources that can fail: told when a problem starts (and null when it ends); returns the remover. */
  subscribeProblems?(listener: ProblemListener): () => void;
  /** Only sources that can fail: try again from the beginning after a problem. */
  retry?(): void;
  /** True for a source that listens to the room: the page asks everyone's agreement before it starts. */
  readonly requiresConsent?: boolean;
  /** Only a source whose server can name voices. */
  readonly names?: NamesControl;
}
