import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
  const active = speakers.find((s) => s.id === activeId);
  const last = utterances[utterances.length - 1];
  const thread = last ? utterances.filter((u) => u.turn === last.turn) : [];
  // gentle traces of earlier turns
  const earlierTurns: Utterance[][] = [];
  for (let i = utterances.length - 1; i >= 0 && earlierTurns.length < 3; i--) {
    const u = utterances[i]!;
    if (u.turn === last?.turn) continue;
    const g = earlierTurns.find((t) => t[0]!.turn === u.turn);
    if (g) g.unshift(u); else earlierTurns.push([u]);
  }
  const byId = (id: string) => speakers.find((s) => s.id === id)!;

  return (
    <div className="relative flex flex-1 flex-col">
      <h1 className="sr-only">Kõneväli</h1>

      {/* Presence currents — one soft mist band per voice, filling the whole field */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-4 -top-28 -bottom-8">
        {speakers.map((s, i) => {
          const p = presenceOf(s.id, utterances, activeId);
          return (
            <div key={s.id} className="presence-current"
              style={{
                top: `${8 + i * (80 / Math.max(1, speakers.length - 1))}%`,
                background: `radial-gradient(60% 50% at ${30 + ((i * 23) % 40)}% 50%, ${colorGlow[s.color]}, transparent 70%)`,
                opacity: p * 0.75,
                transform: `translateY(-50%) scaleY(${0.5 + p})`,
                animationDelay: `${-i * 5}s`,
              }} />
          );
        })}
      </div>

      {/* Presence legend — calm, quiet labels; brightness follows presence */}
      <ul aria-label="Kohalolu vestluses" className="relative flex flex-wrap gap-x-6 gap-y-2 pt-2">
        {speakers.map((s) => {
          const p = presenceOf(s.id, utterances, activeId);
          return (
            <li key={s.id} className="flex items-center gap-2 font-semibold transition-opacity duration-1000" style={{ opacity: 0.35 + p * 0.65 }}>
              <span aria-hidden className="h-1 rounded-full transition-all duration-1000" style={{ width: `${0.75 + p * 2.5}rem`, background: colorGlow[s.color] }} />
              <span className={p >= 1 ? "text-lg" : "text-sm"}>{s.name}</span>
              <span className="sr-only">: {presenceWord(p)}</span>
            </li>
          );
        })}
      </ul>

      {/* Earlier turns leave faint traces */}
      <div className="relative mt-8 space-y-2" aria-label="Varasemad mõtted">
        {earlierTurns.reverse().map((t, i, arr) => {
          const s = byId(t[0]!.speakerId);
          return (
            <p key={t[0]!.turn} className="max-w-3xl truncate text-sm transition-opacity duration-1000" style={{ opacity: 0.25 + (i / Math.max(1, arr.length)) * 0.35 }}>
              <span className="font-bold" style={{ color: colorGlow[s.color] }}>{s.name}</span>{" "}
              <span className="text-muted-foreground">{t.map((u) => u.text).join(" ")}</span>
            </p>
          );
        })}
      </div>

      {/* The current thought thread */}
      <section aria-live="polite" aria-label="Praegune mõttekäik" className="relative flex flex-1 flex-col justify-end py-8">
        {active && thread.length > 0 ? (
          <div className="max-w-4xl">
            <p className="flex items-center gap-3 text-xl font-bold" style={{ color: colorGlow[active.color] }}>
              <span aria-hidden className="relative inline-flex size-4">
                <span className="ripple absolute inset-0 rounded-full border-2" style={{ borderColor: colorGlow[active.color] }} />
              </span>
              {active.name}
            </p>
            <ol className="mt-4 border-l-2 pl-6" style={{ borderColor: `color-mix(in oklab, ${colorGlow[active.color]} 45%, transparent)` }}>
              {thread.slice(-4).map((u, i, arr) => {
                const current = i === arr.length - 1;
                return (
                  <li key={u.id} className={`caption-in relative py-2 transition-all duration-700 ${current ? "text-3xl font-semibold leading-snug sm:text-4xl" : "text-lg text-muted-foreground"}`}
                    style={{ opacity: current ? 1 : 0.45 + (i / arr.length) * 0.4 }}>
                    <span aria-hidden className="absolute -left-[1.95rem] top-1/2 h-0.5 w-4" style={{ background: colorGlow[active.color] }} />
                    {u.text}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="text-2xl text-muted-foreground">{deleted ? "Väli on kustutatud." : "Väli ootab esimest häält…"}</p>
        )}
      </section>

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
