import { Resampler } from "./pcm";

/** Something that delivers microphone audio as 16 kHz 16-bit PCM; replaceable in tests. */
export interface AudioCapture {
  /** Resolves once audio flows; rejects if the microphone is refused or missing. */
  start(onPcm: (pcm: Int16Array) => void): Promise<void>;
  stop(): void;
}

/**
 * The browser microphone. The browser's own noise suppression, echo cancellation and automatic gain are off:
 * the server levels the sound itself and the ASR was measured on unprocessed recordings.
 */
export class MicCapture implements AudioCapture {
  private context?: AudioContext | undefined;
  private stream?: MediaStream | undefined;
  private generation = 0;

  async start(onPcm: (pcm: Int16Array) => void): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop()); // stopped while the permission prompt was open
      return;
    }
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule("/mic-worklet.js");
      if (generation !== this.generation) throw new Error("stopped");
      const resampler = new Resampler(context.sampleRate);
      const node = new AudioWorkletNode(context, "mic-processor", { numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onPcm(resampler.process(e.data));
      const silent = context.createGain(); // some browsers only run a node that reaches the output
      silent.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node).connect(silent).connect(context.destination);
      await context.resume();
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
      if (generation === this.generation) throw error;
      return;
    }
    this.stream = stream;
    this.context = context;
  }

  stop() {
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
    this.stream = undefined;
    this.context = undefined;
  }
}
