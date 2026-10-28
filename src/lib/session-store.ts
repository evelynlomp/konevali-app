import { useSyncExternalStore } from "react";

export type SpeakerColor = "teal" | "petrol" | "forest" | "amber" | "sky" | "coral";

export const COLOR_LABELS: Record<SpeakerColor, string> = {
  teal: "Sinakasroheline",
  petrol: "Petrooleumsinine",
  forest: "Metsaroheline",
  amber: "Merevaigukollane",
  sky: "Taevasinine",
  coral: "Korallpunane",
};

export interface Speaker {
  id: string;
  name: string;
  color: SpeakerColor;
  x: number; // percent
  y: number; // percent
  large: boolean;
  pinned: boolean;
  nameSource: "tuvastatud" | "kasutaja";
}

export interface Utterance {
  id: string;
  speakerId: string;
  time: string;
  text: string;
  turn: string; // fragments of one speaking turn share this id
}

export interface AuditEntry {
  id: string;
  time: string;
  text: string;
}

interface State {
  speakers: Speaker[];
  utterances: Utterance[];
  activeId: string | null;
  previousId: string | null;
  running: boolean;
  audit: AuditEntry[];
  deleted: boolean;
}

const initialSpeakers: Speaker[] = [
  { id: "s1", name: "Mari", color: "teal", x: 16, y: 40, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s2", name: "Jaan", color: "forest", x: 50, y: 8, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s3", name: "Evelyn", color: "coral", x: 84, y: 40, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s4", name: "Kõneleja 4", color: "amber", x: 50, y: 66, large: false, pinned: false, nameSource: "tuvastatud" },
];

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
];
export const SCRIPT: [string, string, number][] = TURNS.flatMap(([sp, frags], turn) =>
  frags.map((f) => [sp, f, turn] as [string, string, number]),
);

const now = () => new Date().toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const initialState: State = {
  speakers: initialSpeakers,
  utterances: [],
  activeId: null,
  previousId: null,
  running: true,
  audit: [{ id: "a0", time: "—", text: "Seanss alustati. Osalejaid teavitati salvestamisest." }],
  deleted: false,
};
let state: State = initialState;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const log = (text: string) => ({ audit: [{ id: crypto.randomUUID(), time: now(), text }, ...state.audit] });

export function useSession() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => initialState,
  );
}

let scriptIndex = 0;
export const actions = {
  tick() {
    if (!state.running || state.deleted) return;
    const [speakerId, text, turnNo] = SCRIPT[scriptIndex % SCRIPT.length]!;
    const round = Math.floor(scriptIndex / SCRIPT.length);
    scriptIndex++;
    set({
      utterances: [...state.utterances, { id: crypto.randomUUID(), speakerId, text, time: now(), turn: `${round}-${turnNo}` }],
      previousId: state.activeId,
      activeId: speakerId,
    });
  },
  toggleRunning() {
    set({ running: !state.running, ...log(state.running ? "Subtiitrid peatati." : "Subtiitrid jätkusid.") });
  },
  updateSpeaker(id: string, patch: Partial<Speaker>, auditText?: string) {
    set({
      speakers: state.speakers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      ...(auditText ? log(auditText) : {}),
    });
  },
  rename(id: string, name: string) {
    const old = state.speakers.find((s) => s.id === id)?.name;
    if (!name.trim() || name === old) return;
    actions.updateSpeaker(id, { name: name.trim(), nameSource: "kasutaja" }, `Kõneleja „${old}” nimetati ümber: „${name.trim()}”.`);
  },
  editUtterance(id: string, text: string) {
    set({ utterances: state.utterances.map((u) => (u.id === id ? { ...u, text } : u)), ...log("Transkripti lõiku muudeti käsitsi.") });
  },
  deleteTranscript() {
    set({ utterances: [], activeId: null, previousId: null, deleted: true, running: false, ...log("Transkript kustutati kasutaja soovil.") });
  },
  restart() {
    scriptIndex = 0;
    set({ deleted: false, running: true, ...log("Uus seanss alustati.") });
  },
  log(text: string) {
    set(log(text));
  },
};
