import { MicCapture, type AudioCapture } from "./mic-capture";
import type { SpeechEvent, SpeechListener, SpeechSource } from "./types";

/** What the live server sends for each finished sentence. Other message types and extra fields are ignored. */
export function parseLiveMessage(data: unknown): SpeechEvent | null {
  if (typeof data !== "string") return null;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  const { type, speaker, text } = message ?? {};
  if (type !== "final" || typeof speaker !== "string" || !speaker.trim() || typeof text !== "string" || !text.trim()) return null;
  return {
    speakerId: speaker.trim(),
    speakerName: `Kõneleja ${speaker.trim()}`,
    text: text.trim(),
    timestamp: Date.now(),
    isFinal: true,
  };
}

/**
 * Listens to the room through the microphone: the audio goes to the live ASR server over a WebSocket and the
 * finished sentences come back. start() opens the microphone and the connection, stop() closes both; a later
 * start() begins a new connection (the server's speaker labels start over).
 *
 * Stage 0: no reconnecting, and failures only reach the console.
 */
export class LiveSpeechSource implements SpeechSource {
  private listeners = new Set<SpeechListener>();
  private socket?: WebSocket | undefined;
  private running = false;

  constructor(
    private readonly url: string,
    private readonly capture: AudioCapture = new MicCapture(),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    socket.onmessage = (e) => {
      const event = parseLiveMessage(e.data);
      if (event) this.listeners.forEach((l) => l(event));
    };
    socket.onclose = () => {
      if (this.socket === socket && this.running) console.warn("Kõneserveri ühendus katkes", this.url);
    };
    socket.onerror = () => console.error(`Kõneserveriga ei saanud ühendust: ${this.url}`);
    this.socket = socket;
    this.capture
      .start((pcm) => {
        // audio before the connection opens is dropped; a few hundred milliseconds of silence at the start do not matter
        if (socket.readyState === WebSocket.OPEN) socket.send(pcm);
      })
      .catch((error) => {
        console.error("Mikrofoni ei saanud avada", error);
        if (this.socket === socket) this.stop();
      });
  }

  stop() {
    this.running = false;
    this.capture.stop();
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }

  subscribe(listener: SpeechListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
