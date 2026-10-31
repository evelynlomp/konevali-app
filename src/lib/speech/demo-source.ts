import type { SpeechEvent, SpeechListener, SpeechSource } from "./types";

const NAMES: Record<string, string> = {
  s1: "Mari",
  s2: "Jaan",
  s3: "Evelyn",
  s4: "Kõneleja 4",
  s5: "Kõneleja 5",
};

// Speaking turns: long contributions are broken into thought units (fragments)
const TURNS: [string, string[]][] = [
  ["s1", ["Tere tulemast kõigile.", "Alustame eelarve aruteluga."]],
  ["s2", [
    "Esiteks: Tallinna kontori kulud on sel kvartalil kasvanud umbes kaheksa protsenti.",
    "Teiseks: suurem osa kasvust tuleb koolitustest, mitte ruumidest.",
    "Peamine ettepanek on koondada koolitused ühte kohta, et kulud oleksid ülevaatlikumad.",
    "Me peaksime otsustama, kas Töötukassa koostööprojekt jääb samasse eelarvesse.",
  ]],
  ["s3", ["Mul on küsimus.", "Kas see sisaldab ka Tartu koolitusi?"]],
  ["s2", ["Jah, sisaldab.", "Töötukassa projekt on seal samuti sees."]],
  ["s4", ["Ma võin koostada täpsema ülevaate järgmiseks reedeks."]],
  ["s3", [
    "Tahaksin lisada ühe mõtte ligipääsetavuse kohta.",
    "Praegu jääb osa inimesi koosolekutel kõrvale, sest nad ei kuule kõike.",
    "Ettepanek: lisame igale koosolekule subtiitrid vaikimisi.",
    "Nii saab igaüks arutelus päriselt osaleda.",
  ]],
  ["s1", ["Olen nõus.", "Otsustame, et alates novembrist teeme nii."]],
  ["s4", ["Panen selle protokolli kirja."]],
  ["s5", ["Vabandust, et hilinesin.", "Kas saaksin lühidalt lisada midagi Tartu kohta?"]],
  ["s1", ["Muidugi, palun."]],
];

const SCRIPT: [string, string][] = TURNS.flatMap(([speakerId, frags]) =>
  frags.map((text) => [speakerId, text] as [string, string]),
);

const FIRST_DELAY_MS = 1200;
const INTERVAL_MS = 4000;

/** Plays a fixed, looping conversation. The first SpeechSource implementation. */
export class DemoSpeechSource implements SpeechSource {
  private listeners = new Set<SpeechListener>();
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(FIRST_DELAY_MS);
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

  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.emit();
      if (this.running) this.schedule(INTERVAL_MS);
    }, delay);
  }

  private emit() {
    const [speakerId, text] = SCRIPT[this.index % SCRIPT.length]!;
    this.index++;
    const event: SpeechEvent = {
      speakerId,
      speakerName: NAMES[speakerId] ?? speakerId,
      text,
      timestamp: Date.now(),
      isFinal: true,
    };
    this.listeners.forEach((l) => l(event));
  }
}
