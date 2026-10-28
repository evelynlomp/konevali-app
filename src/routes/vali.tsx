import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { actions, COLOR_LABELS, useSession, type Speaker, type SpeakerColor, type Utterance } from "@/lib/session-store";
import { colorGlow } from "@/components/AppShell";

export const Route = createFileRoute("/vali")({
  head: () => ({
    meta: [
      { title: "Kõneväli – elav vestlusväli" },
      { name: "description", content: "Vestlus nähtavana: kohalolu, tähelepanu ja mõttekäigud reaalajas subtiitritena." },
      { property: "og:title", content: "Kõneväli – elav vestlusväli" },
      { property: "og:description", content: "Näe, kes on vestluses kohal ja kuhu tähelepanu liigub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FieldPage,
});

/** Presence 0..1: strongest when speaking, fading gently with each fragment since. */
function presenceOf(id: string, utterances: Utterance[], activeId: string | null) {
  if (id === activeId) return 1;
  for (let i = utterances.length - 1, since = 0; i >= 0; i--, since++) {
    if (utterances[i]!.speakerId === id) return Math.max(0.14, 0.8 - since * 0.08);
  }
  return 0.1;
}
const presenceWord = (p: number) => (p >= 1 ? "räägib praegu" : p > 0.5 ? "rääkis hiljuti" : p > 0.2 ? "vaikib" : "pole veel rääkinud");

function FieldPage() {
  const { speakers, utterances, activeId, running, deleted } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  return (
    <div className="relative flex flex-1 flex-col">
      <h1 className="sr-only">Kõneväli</h1>

      {/* Shared spatial field — mist gathers where voices are; names hold their place */}
      <div ref={fieldRef} className="relative min-h-[72vh] flex-1" role="application" aria-label="Vestlusväli: osalejate asukohad" aria-describedby="vali-help">
        <span id="vali-help" className="sr-only">Liiguta nime nooleklahvidega, Shift-klahviga suurem samm. Asukoht jääb püsima.</span>
        {speakers.map((s) => (
          <PresenceName key={s.id} s={s} p={presenceOf(s.id, utterances, activeId)} fieldRef={fieldRef}
            lines={utterances.filter((u) => u.speakerId === s.id).slice(-4)}
            above={speakers.some((o) => o.id !== s.id && o.y > s.y && o.y - s.y < 34 && Math.abs(o.x - s.x) < 26)} />
        ))}
        {utterances.length === 0 && <p className="absolute inset-x-0 bottom-4 text-center text-lg text-muted-foreground">{deleted ? "Väli on kustutatud." : "Väli ootab esimest häält…"}</p>}
      </div>

      {/* Quiet secondary controls */}
      <div className="relative flex flex-wrap items-center gap-3 pb-2 no-print">
        {deleted ? (
          <button onClick={actions.restart} className="min-h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground">Alusta uut seanssi</button>
        ) : (
          <button onClick={actions.toggleRunning} aria-pressed={!running} className="min-h-11 rounded-full border border-border px-5 font-semibold hover:bg-muted">
            {running ? "❚❚ Peata" : "▶ Jätka"}
          </button>
        )}
        <button onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-controls="haalte-seaded" className="min-h-11 rounded-full border border-border px-5 font-semibold hover:bg-muted">
          Häälte seaded
        </button>
      </div>
      {settingsOpen && (
        <div id="haalte-seaded" className="relative grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {speakers.map((s) => <VoiceEditor key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

const EMPHASIS = [1, 0.75, 0.5, 0.25];
function PresenceName({ s, p, fieldRef, lines, above }: { s: Speaker; p: number; fieldRef: React.RefObject<HTMLDivElement | null>; lines: Utterance[]; above: boolean }) {
  const drag = useRef(false);
  const glow = colorGlow[s.color];
  const active = p >= 1;
  const move = (x: number, y: number) => actions.updateSpeaker(s.id, { x: Math.min(94, Math.max(6, x)), y: Math.min(85, Math.max(6, y)) });
  return (
    <div
      role="button" tabIndex={0}
      aria-label={`${s.name}, ${presenceWord(p)}`}
      onKeyDown={(e) => {
        const st = e.shiftKey ? 10 : 3;
        const d = ({ ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] } as Record<string, number[]>)[e.key];
        if (d) { e.preventDefault(); move(s.x + d[0]!, s.y + d[1]!); }
      }}
      onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        if (!drag.current || !fieldRef.current) return;
        const r = fieldRef.current.getBoundingClientRect();
        move(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      }}
      onPointerUp={() => { if (drag.current) actions.log(`Hääle „${s.name}” kohta väljal muudeti.`); drag.current = false; }}
      style={{ left: `${s.x}%`, top: `${s.y}%`, touchAction: "none" }}
      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none rounded-md px-2 active:cursor-grabbing"
    >
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-all duration-[2400ms]"
        style={{ width: `${14 + p * 22}rem`, height: `${5 + p * 7}rem`, background: `radial-gradient(closest-side, ${glow}, transparent)`, filter: "blur(36px)", opacity: 0.12 + p * 0.5 }} />
      <span className="relative block whitespace-nowrap font-display font-bold transition-all duration-1000"
        style={{ fontSize: `${1 + p * 0.45}rem`, opacity: 0.4 + p * 0.6, color: active ? glow : undefined }}>
        {s.name}
      </span>
      <ol aria-live={active ? "polite" : "off"} aria-label={`${s.name} ütles`}
        className={`pointer-events-none absolute left-1/2 w-[17rem] -translate-x-1/2 space-y-1 text-center text-base leading-snug ${above ? "bottom-full mb-2 flex flex-col-reverse" : "top-full mt-2"}`}
        style={{ opacity: 0.35 + p * 0.65 }}>
        {[...lines].reverse().map((u, i) => (
          <li key={u.id} className={`caption-in transition-opacity duration-700 ${i === 0 && active ? "font-semibold" : "text-muted-foreground"}`} style={{ opacity: EMPHASIS[i] }}>{u.text}</li>
        ))}
      </ol>
    </div>
  );
}

function VoiceEditor({ s }: { s: Speaker }) {
  const [name, setName] = useState(s.name);
  const [err, setErr] = useState("");
  const id = `nimi-${s.id}`;
  return (
    <form className="space-y-2 rounded-xl border border-border bg-card p-3 backdrop-blur"
      onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setErr("Nimi ei tohi olla tühi."); setErr(""); actions.rename(s.id, name); }}>
      <label htmlFor={id} className="block text-sm font-bold">Nimi</label>
      <div className="flex gap-2">
        <input id={id} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-3" />
        <button className="min-h-11 rounded-md bg-primary px-3 font-bold text-primary-foreground">Salvesta</button>
      </div>
      {err && <p role="alert" className="font-bold text-destructive">⚠ {err}</p>}
      <fieldset>
        <legend className="sr-only">Värv</legend>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(COLOR_LABELS) as SpeakerColor[]).map((c) => (
            <label key={c} title={COLOR_LABELS[c]} className="flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-transparent has-checked:border-foreground">
              <input type="radio" name={`varv-${s.id}`} className="sr-only" checked={s.color === c} onChange={() => actions.updateSpeaker(s.id, { color: c })} />
              <span aria-hidden className="size-5 rounded-full" style={{ background: colorGlow[c] }} />
              <span className="sr-only">{COLOR_LABELS[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
