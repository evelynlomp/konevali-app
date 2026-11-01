// Runs in the audio thread: collects the microphone's samples and hands them to the page in blocks.
// The page (src/lib/speech/mic-capture.ts) converts them to 16 kHz PCM.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.block[this.filled++] = channel[i];
      if (this.filled === this.block.length) {
        this.port.postMessage(this.block.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
