import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { actions, COLOR_LABELS, useSession, type Speaker, type SpeakerColor, type Utterance } from "@/lib/session-store";
import { colorGlow } from "@/components/AppShell";
import { attentionRanks, EMPHASIS, memoryFromRank, presenceFromRank } from "@/lib/presence";

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

const presenceWord = (p: number) => (p >= 1 ? "räägib praegu" : p > 0.5 ? "rääkis hiljuti" : p > 0.2 ? "vaikib" : "pole veel rääkinud");

function FieldPage() {
  const { speakers, utterances, activeId, running, deleted } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const rank = attentionRanks(utterances, activeId);
  const crowded = speakers.length > 8;
  return (
    <div className="relative flex flex-1 flex-col">
      <h1 className="sr-only">Kõneväli</h1>

      {/* Shared spatial field — mist gathers where voices are; names hold their place */}
      <div ref={fieldRef} className="relative min-h-[72vh] flex-1" role="application" aria-label="Vestlusväli: osalejate asukohad" aria-describedby="vali-help">
        <span id="vali-help" className="sr-only">Liiguta nime nooleklahvidega, Shift-klahviga suurem samm. Asukoht jääb püsima.</span>
        {speakers.map((s) => (
          <PresenceName key={s.id} s={s} p={presenceFromRank(rank(s.id))} fieldRef={fieldRef} crowded={crowded}
            lines={memoryFromRank(rank(s.id)) ? utterances.filter((u) => u.speakerId === s.id).slice(-memoryFromRank(rank(s.id))) : []}
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
          Osalejad
        </button>
      </div>
      {settingsOpen && (
        <section id="haalte-seaded" aria-label="Osalejate seaded" className="relative pb-4">
          <p className="mb-3 text-sm text-muted-foreground">{speakers.length} osalejat · uued kõnelejad lisanduvad tuvastamisel automaatselt</p>
          <AddParticipant />
          <ul className="mt-3 max-h-[60vh] divide-y divide-border overflow-y-auto border-y border-border">
            {speakers.map((s) => <VoiceEditor key={s.id} s={s} others={speakers.filter((o) => o.id !== s.id)} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function PresenceName({ s, p, fieldRef, lines, above, crowded }: { s: Speaker; p: number; crowded: boolean; fieldRef: React.RefObject<HTMLDivElement | null>; lines: Utterance[]; above: boolean }) {
  const drag = useRef(false);
  const glow = colorGlow[s.color];
  const active = p >= 1;
  const move = (x: number, y: number) => actions.updateSpeaker(s.id, { x: Math.min(94, Math.max(6, x)), y: Math.min(85, Math.max(6, y)) });
  return (
    <div
      role="button" tabIndex={0} id={`nimi-valjal-${s.id}`}
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
        style={{ fontSize: `${(crowded ? 0.9 : 1) + p * 0.45}rem`, opacity: 0.4 + p * 0.6, color: active ? glow : undefined }}>
        {s.name}
        {active && <span aria-hidden className="mx-auto mt-0.5 block h-0.5 w-2/3 rounded-full bg-foreground" />}
      </span>
      <ol aria-live={active ? "polite" : "off"} aria-label={`${s.name} ütles`}
        className={`pointer-events-none absolute left-1/2 h-0 w-[18rem] -translate-x-1/2 text-center text-base leading-snug ${above ? "bottom-full mb-3" : "top-full mt-3"}`}
        style={{ opacity: 0.35 + p * 0.65 }}>
        {(() => {
          // newest sits closest to the name; older ones drift outward and fade
          const recent = [...lines].reverse();
          let offset = 0;
          return recent.map((u, i) => {
            const rows = i === 0 ? Math.ceil(u.text.length / 32) : Math.min(2, Math.ceil(u.text.length / 34));
            const y = offset + i * 0.5; offset += rows * 1.4;
            return (
              <li key={u.id} className={`absolute inset-x-0 ${above ? "bottom-0" : "top-0"} ${i === 0 && active ? "font-semibold" : "text-muted-foreground"} ${i > 0 ? "line-clamp-2" : ""}`}
                style={{ transform: `translateY(${above ? -y : y}rem) scale(${1 - i * 0.04})`, opacity: EMPHASIS[i] ?? 0, transition: "transform 1.8s cubic-bezier(.22,.8,.3,1), opacity 2.2s ease" }}>{u.text}</li>
            );
          });
        })()}
      </ol>
    </div>
  );
}

function AddParticipant() {
  const [name, setName] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); actions.addSpeaker(name); setName(""); }}>
      <label className="flex flex-col text-sm font-bold">Lisa osaleja
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nimi (valikuline)"
          className="mt-1 min-h-11 w-56 rounded-md border border-input bg-background/60 px-3 font-normal" />
      </label>
      <button className="min-h-11 rounded-full bg-primary px-5 font-bold text-primary-foreground">+ Lisa osaleja</button>
    </form>
  );
}

function VoiceEditor({ s, others }: { s: Speaker; others: Speaker[] }) {
  const [name, setName] = useState(s.name);
  const [mergeInto, setMergeInto] = useState("");
  const id = `nimi-${s.id}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) actions.rename(s.id, name); }}>
        <label htmlFor={id} className="sr-only">Nimi</label>
        <input id={id} value={name} onChange={(e) => setName(e.target.value)}
          className="min-h-11 w-44 rounded-md border border-input bg-background/60 px-3 font-bold" />
        <button className="min-h-11 rounded-md border border-border px-3 font-semibold hover:bg-muted">Salvesta</button>
      </form>
      <fieldset className="flex gap-0.5">
        <legend className="sr-only">Värv: {s.name}</legend>
        {(Object.keys(COLOR_LABELS) as SpeakerColor[]).map((c) => (
          <label key={c} title={COLOR_LABELS[c]} className="flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-transparent has-checked:border-foreground">
            <input type="radio" name={`varv-${s.id}`} className="sr-only" checked={s.color === c} onChange={() => actions.updateSpeaker(s.id, { color: c })} />
            <span aria-hidden className="size-5 rounded-full" style={{ background: colorGlow[c] }} />
            <span className="sr-only">{COLOR_LABELS[c]}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={() => document.getElementById(`nimi-valjal-${s.id}`)?.focus()} className="min-h-11 rounded-md px-3 font-semibold underline-offset-4 hover:underline">
        Paiguta väljal
      </button>
      {others.length > 0 && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (mergeInto && confirm(`Liita „${s.name}” teise kõnelejaga? Tema read lähevad üle.`)) actions.merge(s.id, mergeInto); }}>
          <label className="sr-only" htmlFor={`liida-${s.id}`}>Liida kõnelejaga</label>
          <select id={`liida-${s.id}`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="min-h-11 rounded-md border border-input bg-popover px-2">
            <option value="">Liida kõnelejaga…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button disabled={!mergeInto} className="min-h-11 rounded-md border border-border px-3 font-semibold disabled:opacity-50">Liida</button>
        </form>
      )}
      <button type="button" onClick={() => { if (confirm(`Eemaldada „${s.name}” väljalt?`)) actions.removeSpeaker(s.id); }} className="ml-auto min-h-11 rounded-md px-3 font-semibold text-destructive hover:underline">
        Eemalda
      </button>
    </li>
  );
}
