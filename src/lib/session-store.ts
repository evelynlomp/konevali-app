import { useSyncExternalStore } from "react";
import { builtForLiveServer, type SpeechEvent } from "./speech";

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
  /** When the app received it (ms). Drives fading, so it never depends on the source's clock. */
  at: number;
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
  /** Bumped on restart so the app can attach a fresh speech source. */
  sessionId: number;
  /** speakerId → arrival time of their latest sentence; absent = has not spoken. */
  lastSpokeAt: Record<string, number>;
  /** The user chose "Alusta nimedega": the participants panel opens on the consent step for names. */
  namesRequested: boolean;
}

/** The made-up people of the demo (and of the home page's example). */
export const DEMO_SPEAKERS: Speaker[] = [
  { id: "s1", name: "Mari", color: "teal", x: 16, y: 40, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s2", name: "Jaan", color: "forest", x: 50, y: 8, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s3", name: "Evelyn", color: "coral", x: 84, y: 40, large: false, pinned: false, nameSource: "tuvastatud" },
  { id: "s4", name: "Kõneleja 4", color: "amber", x: 50, y: 66, large: false, pinned: false, nameSource: "tuvastatud" },
];

/** Order defines automatic assignment; colour is never the only cue. */
export const PALETTE: SpeakerColor[] = ["teal", "amber", "sky", "coral", "forest", "petrol"];

function autoColor(list: Speaker[]): SpeakerColor {
  const used = (c: SpeakerColor) => list.filter((s) => s.color === c).length;
  return [...PALETTE].sort((a, b) => used(a) - used(b) || PALETTE.indexOf(a) - PALETTE.indexOf(b))[0]!;
}

/** Find the free spot farthest from everyone already in the field. */
export function freeSpot(list: Speaker[]): { x: number; y: number } {
  let best = { x: 50, y: 40 }, bestD = -1;
  for (let gx = 10; gx <= 90; gx += 8) for (let gy = 8; gy <= 80; gy += 8) {
    const d = list.length ? Math.min(...list.map((s) => Math.hypot(s.x - gx, (s.y - gy) * 1.4))) : 99 - Math.abs(gx - 50);
    if (d > bestD) { bestD = d; best = { x: gx, y: gy }; }
  }
  return best;
}

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const now = () => formatTime(Date.now());

// a page built for a live server starts with an empty field, so not even a flash of the made-up people shows
const initialState: State = {
  speakers: builtForLiveServer() ? [] : DEMO_SPEAKERS,
  utterances: [],
  activeId: null,
  previousId: null,
  running: true,
  audit: [{ id: "a0", time: "—", text: "Seanss alustati." }],
  deleted: false,
  sessionId: 0,
  lastSpokeAt: {},
  namesRequested: false,
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

export const actions = {
  /** Single entry point for speech, whatever its source. */
  ingest(event: SpeechEvent) {
    if (!state.running || state.deleted) return;
    // Interim hypotheses are not shown yet; only settled text reaches the field.
    if (!event.isFinal) return;
    const { speakerId, speakerName, text, timestamp } = event;
    // The name only seeds a new speaker; later renames by the user always win.
    if (!state.speakers.some((s) => s.id === speakerId)) actions.addSpeaker(speakerName, speakerId, true);
    const last = state.utterances[state.utterances.length - 1];
    const at = Date.now();
    set({
      utterances: [
        ...state.utterances,
        { id: crypto.randomUUID(), speakerId, text, time: formatTime(timestamp), at, turn: last?.speakerId === speakerId ? last.turn : crypto.randomUUID() },
      ],
      lastSpokeAt: { ...state.lastSpokeAt, [speakerId]: at },
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
    set({ utterances: [], lastSpokeAt: {}, activeId: null, previousId: null, deleted: true, running: false, ...log("Transkript kustutati kasutaja soovil.") });
  },
  restart() {
    set({ deleted: false, running: true, sessionId: state.sessionId + 1, namesRequested: false, ...log("Uus seanss alustati.") });
  },
  requestNames(on = true) {
    if (state.namesRequested !== on) set({ namesRequested: on });
  },
  addSpeaker(name?: string, id: string = crypto.randomUUID(), detected = false) {
    const n = name?.trim() || `Kõneleja ${state.speakers.length + 1}`;
    const sp: Speaker = { id, name: n, color: autoColor(state.speakers), ...freeSpot(state.speakers), large: false, pinned: false, nameSource: detected ? "tuvastatud" : "kasutaja" };
    set({ speakers: [...state.speakers, sp], ...log(detected ? `Tuvastati uus kõneleja: „${n}”.` : `Lisati osaleja „${n}”.`) });
  },
  removeSpeaker(id: string) {
    const s = state.speakers.find((x) => x.id === id);
    if (!s) return;
    const { [id]: _removed, ...lastSpokeAt } = state.lastSpokeAt;
    set({ speakers: state.speakers.filter((x) => x.id !== id), lastSpokeAt, activeId: state.activeId === id ? null : state.activeId, ...log(`Osaleja „${s.name}” eemaldati väljalt.`) });
  },
  /** Empties the field for a source that brings its own speakers (a replay); no audit entries. */
  clearSpeakers() {
    set({ speakers: [], utterances: [], lastSpokeAt: {}, activeId: null, previousId: null });
  },
  merge(fromId: string, intoId: string) {
    const a = state.speakers.find((x) => x.id === fromId), b = state.speakers.find((x) => x.id === intoId);
    if (!a || !b || a.id === b.id) return;
    const { [fromId]: fromAt, ...lastSpokeAt } = state.lastSpokeAt;
    if (fromAt !== undefined) lastSpokeAt[intoId] = Math.max(fromAt, lastSpokeAt[intoId] ?? 0);
    set({
      speakers: state.speakers.filter((x) => x.id !== fromId),
      lastSpokeAt,
      utterances: state.utterances.map((u) => (u.speakerId === fromId ? { ...u, speakerId: intoId } : u)),
      activeId: state.activeId === fromId ? intoId : state.activeId,
      ...log(`Kõneleja „${a.name}” liideti kõnelejaga „${b.name}”.`),
    });
  },
  log(text: string) {
    set(log(text));
  },
};
