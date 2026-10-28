import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { actions, COLOR_LABELS, useSession, type Speaker, type SpeakerColor } from "@/lib/session-store";
import { colorBg, colorBorder, colorStroke } from "@/components/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Otseülekanne – RuumiSubtiitrid" },
      { name: "description", content: "Reaalajas subtiitrid ruumikaardil: näe, kes räägib, kus ta istub ja kuidas vestlus liigub." },
      { property: "og:title", content: "Otseülekanne – RuumiSubtiitrid" },
      { property: "og:description", content: "Reaalajas subtiitrid ruumikaardil kuulmispuudega inimestele ja koosolekutele." },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const { speakers, utterances, activeId, previousId, running, deleted } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const lastBy = (id: string) => [...utterances].reverse().find((u) => u.speakerId === id);
  const active = speakers.find((s) => s.id === activeId);
  const prev = speakers.find((s) => s.id === previousId);
  const sel = speakers.find((s) => s.id === selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="ruum">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="ruum" className="text-3xl font-bold">Ruumikaart</h1>
            <p className="text-muted-foreground">Lohista kõnelejad nende tegelikule kohale või kasuta nooleklahve.</p>
          </div>
          {deleted ? (
            <button onClick={actions.restart} className="min-h-11 rounded-md bg-primary px-5 font-bold text-primary-foreground">Alusta uut seanssi</button>
          ) : (
            <button onClick={actions.toggleRunning} aria-pressed={!running} className="min-h-11 rounded-md border-2 border-secondary px-5 font-bold text-secondary hover:bg-muted">
              {running ? "❚❚ Peata subtiitrid" : "▶ Jätka subtiitreid"}
            </button>
          )}
        </div>

        <div ref={roomRef} className="room-grid relative aspect-[4/3] min-h-[28rem] w-full overflow-hidden rounded-md border-2 border-secondary">
          <div aria-hidden className="absolute left-1/2 top-1/2 h-[38%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-dashed border-muted-foreground/60 flex items-center justify-center text-sm font-bold text-muted-foreground">
            LAUD
          </div>
          {active && prev && active.id !== prev.id && (
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill={colorStroke[active.color]} />
                </marker>
              </defs>
              <line x1={`${prev.x}%`} y1={`${prev.y}%`} x2={`${active.x}%`} y2={`${active.y}%`} stroke={colorStroke[active.color]} strokeWidth="3" strokeDasharray="8 6" markerEnd="url(#arrow)" />
            </svg>
          )}
          {speakers.map((s) => (
            <SpeakerCard key={s.id} s={s} active={s.id === activeId} caption={lastBy(s.id)?.text} roomRef={roomRef} onSelect={() => setSelected(s.id)} selected={s.id === selected} />
          ))}
        </div>

        <div aria-live="polite" className="mt-4 rounded-md border-l-8 border-primary bg-card p-4">
          <p className="text-sm font-bold text-muted-foreground">Praegu räägib</p>
          {active ? (
            <p className="text-2xl"><strong>{active.name}:</strong> {lastBy(active.id)?.text}</p>
          ) : (
            <p className="text-xl text-muted-foreground">{deleted ? "Transkript on kustutatud." : "Ootame kõnet…"}</p>
          )}
        </div>
      </section>

      <aside aria-labelledby="osalejad" className="space-y-4">
        <h2 id="osalejad" className="text-xl font-bold">Osalejad</h2>
        <ul className="space-y-2">
          {[...speakers].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((s) => (
            <li key={s.id}>
              <button onClick={() => setSelected(s.id)} aria-pressed={s.id === selected}
                className={`flex w-full min-h-11 items-center gap-3 rounded-md border-2 bg-card px-3 py-2 text-left ${s.id === selected ? "border-secondary" : "border-border"}`}>
                <span aria-hidden className={`size-4 rounded-sm ${colorBg[s.color]}`} />
                <span className="flex-1 font-bold">{s.name}</span>
                {s.pinned && <span className="text-xs font-bold">📌 Kinnitatud</span>}
                {s.id === activeId && <span className="text-xs font-bold text-live">● Räägib</span>}
              </button>
            </li>
          ))}
        </ul>
        {sel ? <SpeakerEditor key={sel.id} s={sel} /> : <p className="text-muted-foreground">Vali osaleja, et muuta nime, värvi või suurust.</p>}
      </aside>
    </div>
  );
}

function SpeakerCard({ s, active, caption, roomRef, onSelect, selected }: {
  s: Speaker; active: boolean; caption?: string; roomRef: React.RefObject<HTMLDivElement | null>; onSelect: () => void; selected: boolean;
}) {
  const drag = useRef(false);
  const move = (x: number, y: number) => actions.updateSpeaker(s.id, { x: Math.min(92, Math.max(8, x)), y: Math.min(90, Math.max(10, y)) });
  return (
    <div
      role="group"
      aria-label={`${s.name}${active ? ", räägib praegu" : ""}`}
      tabIndex={0}
      aria-describedby="drag-help"
      onFocus={onSelect}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 3;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); move(s.x + d[0], s.y + d[1]); }
      }}
      onPointerDown={(e) => { drag.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); onSelect(); }}
      onPointerMove={(e) => {
        if (!drag.current || !roomRef.current) return;
        const r = roomRef.current.getBoundingClientRect();
        move(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      }}
      onPointerUp={() => { if (drag.current) actions.log(`Kõneleja „${s.name}” asukohta muudeti.`); drag.current = false; }}
      style={{ left: `${s.x}%`, top: `${s.y}%`, touchAction: "none" }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none rounded-md border-4 bg-card shadow-md active:cursor-grabbing ${
        s.large ? "w-80" : "w-56"} ${active ? `${colorBorder[s.color]} ring-4 ring-ring z-20` : selected ? "border-secondary z-10" : "border-border"}`}
    >
      <div className={`flex items-center justify-between px-3 py-1.5 font-bold text-primary-foreground ${colorBg[s.color]}`}>
        <span className={s.large ? "text-xl" : ""}>{s.pinned && <span aria-label="Kinnitatud">📌 </span>}{s.name}</span>
        {active && <span className="text-xs uppercase tracking-wide">● Räägib</span>}
      </div>
      <p key={caption} className={`caption-in px-3 py-2 ${s.large ? "text-xl" : "text-base"} ${caption ? "" : "text-muted-foreground italic"}`}>
        {caption ? `„${caption}”` : "Pole veel rääkinud"}
      </p>
      <span id="drag-help" className="sr-only">Liiguta nooleklahvidega, Shift-klahviga suurem samm.</span>
    </div>
  );
}

function SpeakerEditor({ s }: { s: Speaker }) {
  const [name, setName] = useState(s.name);
  const [err, setErr] = useState("");
  return (
    <form className="space-y-4 rounded-md border-2 border-border bg-card p-4"
      onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setErr("Nimi ei tohi olla tühi."); setErr(""); actions.rename(s.id, name); }}>
      <h3 className="font-bold text-lg">Muuda: {s.name}</h3>
      <p className="text-sm text-muted-foreground">Nimi: {s.nameSource === "kasutaja" ? "sisestatud käsitsi" : "tuvastatud automaatselt – palun kontrolli"}</p>
      <div>
        <label htmlFor="nimi" className="block font-bold">Nimi</label>
        <div className="flex gap-2">
          <input id="nimi" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "nimi-viga" : undefined}
            className="min-h-11 flex-1 rounded-md border-2 border-input bg-background px-3" />
          <button className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">Salvesta</button>
        </div>
        {err && <p id="nimi-viga" role="alert" className="mt-1 font-bold text-destructive">⚠ {err}</p>}
      </div>
      <fieldset>
        <legend className="font-bold">Värv</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {(Object.keys(COLOR_LABELS) as SpeakerColor[]).map((c) => (
            <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 border-border px-2 text-sm has-checked:border-secondary has-checked:font-bold">
              <input type="radio" name="varv" className="sr-only" checked={s.color === c} onChange={() => actions.updateSpeaker(s.id, { color: c })} />
              <span aria-hidden className={`size-4 shrink-0 rounded-sm ${colorBg[c]}`} />{COLOR_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={s.large} onClick={() => actions.updateSpeaker(s.id, { large: !s.large })} className="min-h-11 flex-1 rounded-md border-2 border-secondary px-3 font-bold">
          {s.large ? "Vähenda kaarti" : "Suurenda kaarti"}
        </button>
        <button type="button" aria-pressed={s.pinned} onClick={() => actions.updateSpeaker(s.id, { pinned: !s.pinned })} className="min-h-11 flex-1 rounded-md border-2 border-secondary px-3 font-bold">
          {s.pinned ? "Eemalda kinnitus" : "Kinnita esile"}
        </button>
      </div>
    </form>
  );
}
