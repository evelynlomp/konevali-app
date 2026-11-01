/** The format the live server expects: 16 kHz, mono, 16-bit PCM. */
export const TARGET_RATE = 16000;

function toInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return Math.round(s < 0 ? s * 32768 : s * 32767);
}

/**
 * Turns the microphone's audio (usually 44.1 or 48 kHz floats) into 16 kHz 16-bit samples by averaging, so the
 * high frequencies are filtered out instead of folded back into speech. Keeps its place between chunks.
 */
export class Resampler {
  /** Input samples per output sample. */
  private readonly ratio: number;
  private sum = 0;
  /** How much of the current output sample has been filled, in input samples. */
  private filled = 0;

  constructor(inputRate: number, outputRate = TARGET_RATE) {
    if (!(inputRate >= outputRate)) throw new RangeError(`Sample rate ${inputRate} Hz is below ${outputRate} Hz`);
    this.ratio = inputRate / outputRate;
  }

  process(input: Float32Array): Int16Array {
    const out: number[] = [];
    for (const x of input) {
      let left = 1; // part of this input sample not used yet
      while (left > 1e-9) {
        const room = this.ratio - this.filled;
        if (left < room - 1e-9) {
          this.sum += x * left;
          this.filled += left;
          break;
        }
        this.sum += x * room;
        left -= room;
        out.push(toInt16(this.sum / this.ratio));
        this.sum = 0;
        this.filled = 0;
      }
    }
    return Int16Array.from(out);
  }
}
