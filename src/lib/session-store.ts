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
  { id: "s1", name: "Mari", color: "teal", x: 22, y: 26, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s2", name: "Jaan", color: "forest", x: 72, y: 24, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s3", name: "Evelyn", color: "coral", x: 70, y: 72, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s4", name: "Kõneleja 4", color: "amber", x: 24, y: 72, large: false, pinned: false, nameSource: "tuvastatud" },
];

export const SCRIPT: [string, string][] = [
  ["s1", "Tere tulemast kõigile. Alustame eelarve aruteluga."],
  ["s2", "Aitäh. Tallinna kontori kulud on sel kvartalil kasvanud."],
  ["s3", "Mul on küsimus. Kas see sisaldab ka Tartu koolitusi?"],
  ["s2", "Jah, sisaldab. Töötukassa koostööprojekt on seal samuti sees."],
  ["s4", "Ma võin koostada täpsema ülevaate järgmiseks reedeks."],
  ["s1", "Väga hea. Kas saame liikuda järgmise teema juurde?"],
  ["s2", "Jah, jätkame."],
  ["s3", "Ettepanek: lisame igale koosolekule subtiitrid vaikimisi."],
  ["s1", "Olen nõus. Otsustame, et alates novembrist teeme nii."],
  ["s4", "Panen selle protokolli kirja."],
];

const now = () => new Date().toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

let state: State = {
  speakers: initialSpeakers,
  utterances: [],
  activeId: null,
  previousId: null,
  running: true,
  audit: [{ id: "a0", time: "—", text: "Seanss alustati. Osalejaid teavitati salvestamisest." }],
  deleted: false,
};
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
    () => state,
  );
}

let scriptIndex = 0;
export const actions = {
  tick() {
    if (!state.running || state.deleted) return;
    const [speakerId, text] = SCRIPT[scriptIndex % SCRIPT.length]!;
    scriptIndex++;
    set({
      utterances: [...state.utterances, { id: crypto.randomUUID(), speakerId, text, time: now() }],
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
