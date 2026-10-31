import type { SpeechEvent, SpeechListener, SpeechSource } from "./types";

/** One recognised sentence in a replay file. Extra fields in the file are ignored. */
export interface ReplayEvent {
  /** Milliseconds from the start of the recording to when the sentence ended (when the "final" would arrive). */
  t: number;
  /** Anonymous speaker label, e.g. "A", "B". */
  speaker: string;
  text: string;
}

export interface Replay {
  events: ReplayEvent[];
  /** Optional display names by speaker label; otherwise "Kõneleja <label>". */
  names: Record<string, string>;
}

/** Reads a replay file's JSON, dropping events that are incomplete and sorting the rest by time. */
export function parseReplay(json: unknown): Replay {
  const root = (json && typeof json === "object" ? json : {}) as { events?: unknown; names?: unknown };
  const events: ReplayEvent[] = [];
  if (Array.isArray(root.events)) {
    for (const e of root.events) {
      const { t, speaker, text } = (e ?? {}) as Record<string, unknown>;
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
      if (typeof speaker !== "string" || !speaker.trim()) continue;
      if (typeof text !== "string" || !text.trim()) continue;
      events.push({ t, speaker: speaker.trim(), text: text.trim() });
    }
  }
  events.sort((a, b) => a.t - b.t);
  const names: Record<string, string> = {};
  if (root.names && typeof root.names === "object") {
    for (const [label, name] of Object.entries(root.names)) if (typeof name === "string" && name.trim()) names[label] = name.trim();
  }
  return { events, names };
}

/**
 * Plays a recorded conversation from a JSON file, keeping the gaps between sentences.
 * Pausing keeps the position; resuming waits out the next gap again. It stops after the last event.
 */
export class ReplaySpeechSource implements SpeechSource {
  private listeners = new Set<SpeechListener>();
  private loading: Promise<boolean> | undefined;
  private replay: Replay = { events: [], names: {} };
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(private readonly url: string) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.loading ??= this.load();
    void this.loading.then((ok) => {
      if (ok && this.running) this.schedule();
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  subscribe(listener: SpeechListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async load(): Promise<boolean> {
    try {
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.replay = parseReplay(await res.json());
      return true;
    } catch (error) {
      console.error(`Taasesituse faili ei saanud laadida: ${this.url}`, error);
      return false;
    }
  }

  private schedule() {
    clearTimeout(this.timer); // start() may be called again before the file has loaded
    const next = this.replay.events[this.index];
    if (!next) return;
    const previous = this.replay.events[this.index - 1];
    this.timer = setTimeout(() => {
      this.emit();
      if (this.running) this.schedule();
    }, Math.max(0, next.t - (previous?.t ?? 0)));
  }

  private emit() {
    const e = this.replay.events[this.index]!;
    this.index++;
    const event: SpeechEvent = {
      speakerId: e.speaker,
      speakerName: this.replay.names[e.speaker] ?? `Kõneleja ${e.speaker}`,
      text: e.text,
      timestamp: Date.now(),
      isFinal: true,
    };
    this.listeners.forEach((l) => l(event));
  }
}
