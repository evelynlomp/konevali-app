import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { actions, COLOR_LABELS, useSession, type Speaker, type SpeakerColor } from "@/lib/session-store";
import { colorGlow } from "@/components/AppShell";

export const Route = createFileRoute("/vali")({
  head: () => ({
    meta: [
      { title: "Kõneväli – elav vestlusväli" },
      { name: "description", content: "Vestlus nähtavana: kõnelejad valguspunktidena, vestluse voog ja subtiitrid reaalajas." },
      { property: "og:title", content: "Kõneväli – elav vestlusväli" },
      { property: "og:description", content: "Näe, kes räägib, ja kuidas vestlus liigub — pehme elav väli, mitte tabelid." },
    ],
  }),
  component: FieldPage,
});

function FieldPage() {
  const { speakers, utterances, activeId, previousId, running, deleted } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const lastBy = (id: string) => [...utterances].reverse().find((u) => u.speakerId === id);
  const active = speakers.find((s) => s.id === activeId);
  const prev = speakers.find((s) => s.id === previousId);
  const sel = speakers.find((s) => s.id === selected);

  // Curved trace from previous to active speaker
  const trace = active && prev && active.id !== prev.id
    ? (() => {
        const mx = (prev.x + active.x) / 2;
        const my = Math.min(prev.y, active.y) - 14;
        return `M ${prev.x} ${prev.y} Q ${mx} ${my} ${active.x} ${active.y}`;
      })()
    : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div>
          <h1 className="text-2xl font-bold">Kõneväli</h1>
          <p className="text-sm text-muted-foreground">Vestlus on nähtav väljana. Lohista valguspunkte või liiguta neid nooleklahvidega.</p>
        </div>
        {deleted ? (
          <button onClick={actions.restart} className="min-h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground">Alusta uut seanssi</button>
        ) : (
          <button onClick={actions.toggleRunning} aria-pressed={!running} className="min-h-11 rounded-full border-2 border-secondary px-5 font-bold text-secondary hover:bg-muted">
            {running ? "❚❚ Peata" : "▶ Jätka"}
          </button>
        )}
      </div>

      {/* The living field — fills the screen */}
      <div
        ref={fieldRef}
        className="aurora-field relative min-h-[32rem] w-full flex-1 overflow-hidden rounded-2xl lg:min-h-[70vh]"
        role="application"
        aria-label="Vestlusväli: kõnelejad valguspunktidena"
      >
        <div aria-hidden className="aurora-blob left-[5%] top-[8%] size-80" style={{ background: "var(--glow-teal)" }} />
        <div aria-hidden className="aurora-blob right-[4%] top-[35%] size-96" style={{ background: "var(--glow-petrol)", animationDelay: "-9s" }} />
        <div aria-hidden className="aurora-blob bottom-[5%] left-[35%] size-72" style={{ background: "var(--glow-forest)", animationDelay: "-17s" }} />

        {trace && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={trace} fill="none" stroke={colorGlow[active!.color]} strokeWidth="0.5" strokeLinecap="round" className="trace-flow" opacity="0.9" />
          </svg>
        )}

        {speakers.map((s) => (
          <Presence
            key={s.id}
            s={s}
            active={s.id === activeId}
            caption={lastBy(s.id)?.text}
            fieldRef={fieldRef}
            onSelect={() => setSelected(s.id)}
            selected={s.id === selected}
          />
        ))}

        {/* Current voice — large, calm, bottom of the field */}
        <div aria-live="polite" className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-field/95 via-field/70 to-transparent px-6 pb-6 pt-16">
          <p className="text-sm font-bold uppercase tracking-widest text-field-soft">Praegu kõlab</p>
          {active ? (
            <p key={lastBy(active.id)?.id} className="caption-in mt-1 max-w-4xl text-2xl font-semibold text-field-foreground sm:text-3xl">
              <span style={{ color: colorGlow[active.color] }}>{active.name}:</span> {lastBy(active.id)?.text}
            </p>
          ) : (
            <p className="mt-1 text-xl text-field-soft">{deleted ? "Väli on kustutatud." : "Väli ootab esimest häält…"}</p>
          )}
        </div>
      </div>

      {/* Secondary controls */}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] no-print">
        <section aria-labelledby="osalejad">
          <h2 id="osalejad" className="text-lg font-bold">Hääled väljal</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {speakers.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSelected(s.id)}
                  aria-pressed={s.id === selected}
                  className={`flex min-h-11 items-center gap-2 rounded-full border-2 bg-card px-4 font-semibold ${s.id === selected ? "border-secondary" : "border-border"}`}
                >
                  <span aria-hidden className="size-3 rounded-full" style={{ background: colorGlow[s.color] }} />
                  {s.name}
                  {s.id === activeId && <span className="text-xs font-bold text-live">● kõlab</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {sel && <VoiceEditor key={sel.id} s={sel} />}
      </div>
    </div>
  );
}

function Presence({ s, active, caption, fieldRef, onSelect, selected }: {
  s: Speaker; active: boolean; caption?: string | undefined; fieldRef: React.RefObject<HTMLDivElement | null>; onSelect: () => void; selected: boolean;
}) {
  const drag = useRef(false);
  const glow = colorGlow[s.color];
  const move = (x: number, y: number) => actions.updateSpeaker(s.id, { x: Math.min(92, Math.max(8, x)), y: Math.min(88, Math.max(12, y)) });

  return (
    <div
      role="group"
      aria-label={`${s.name}${active ? ", räägib praegu" : ""}`}
      tabIndex={0}
      aria-describedby="vali-help"
      onFocus={onSelect}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 3;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); move(s.x + d[0]!, s.y + d[1]!); }
      }}
      onPointerDown={(e) => { drag.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onSelect(); }}
      onPointerMove={(e) => {
        if (!drag.current || !fieldRef.current) return;
        const r = fieldRef.current.getBoundingClientRect();
        move(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      }}
      onPointerUp={() => { if (drag.current) actions.log(`Hääle „${s.name}” kohta väljal muudeti.`); drag.current = false; }}
      style={{ left: `${s.x}%`, top: `${s.y}%`, touchAction: "none" }}
      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none active:cursor-grabbing"
    >
      <div className="flex flex-col items-center gap-2">
        {/* The orb of presence */}
        <span
          aria-hidden
          className={`block rounded-full ${active ? "breathe" : ""} ${selected ? "ring-4 ring-field-foreground/70" : ""}`}
          style={{
            width: active ? "4.5rem" : "3rem",
            height: active ? "4.5rem" : "3rem",
            background: `radial-gradient(circle at 35% 35%, ${glow}, transparent 70%)`,
            boxShadow: `0 0 ${active ? "3.5rem" : "1.75rem"} ${glow}`,
            opacity: active ? 1 : 0.75,
            transition: "width .4s, height .4s, box-shadow .4s, opacity .4s",
          }}
        />
        <span className={`rounded-full px-3 py-0.5 font-bold text-field-foreground ${active ? "text-lg" : "text-sm"} bg-field/60 backdrop-blur-sm`}>
          {s.name}
        </span>
        {caption && (
          <span key={caption} className={`caption-in max-w-56 rounded-xl bg-field/60 px-3 py-1.5 text-center text-sm text-field-soft backdrop-blur-sm ${active ? "text-base text-field-foreground" : ""}`}>
            „{caption}”
          </span>
        )}
      </div>
      <span id="vali-help" className="sr-only">Liiguta nooleklahvidega, Shift-klahviga suurem samm.</span>
    </div>
  );
}

function VoiceEditor({ s }: { s: Speaker }) {
  const [name, setName] = useState(s.name);
  const [err, setErr] = useState("");
  return (
    <form className="space-y-3 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setErr("Nimi ei tohi olla tühi."); setErr(""); actions.rename(s.id, name); }}>
      <h3 className="font-bold">Hääle seaded: {s.name}</h3>
      <div>
        <label htmlFor="nimi" className="block text-sm font-bold">Nimi</label>
        <div className="flex gap-2">
          <input id="nimi" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "nimi-viga" : undefined}
            className="min-h-11 flex-1 rounded-md border-2 border-input bg-background px-3" />
          <button className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">Salvesta</button>
        </div>
        {err && <p id="nimi-viga" role="alert" className="mt-1 font-bold text-destructive">⚠ {err}</p>}
      </div>
      <fieldset>
        <legend className="text-sm font-bold">Värv</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(Object.keys(COLOR_LABELS) as SpeakerColor[]).map((c) => (
            <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-border px-3 text-sm has-checked:border-secondary has-checked:font-bold">
              <input type="radio" name="varv" className="sr-only" checked={s.color === c} onChange={() => actions.updateSpeaker(s.id, { color: c })} />
              <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: colorGlow[c] }} />{COLOR_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>
    </form>
  );
}
