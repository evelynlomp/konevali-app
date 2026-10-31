import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { actions, COLOR_LABELS, useSession, type Speaker, type SpeakerColor, type Utterance } from "@/lib/session-store";
import { colorGlow } from "@/components/AppShell";
import { captionFade, EMPHASIS, type Activity } from "@/lib/presence";
import { CAPTION_ITEM_GAP, captionLinePx, shownLines, type Placement } from "@/lib/caption-layout";
import { layoutField, nameRem, NO_HIDING, PHONE_MAX_W, type HidingState } from "@/lib/field-layout";
import { useElementSize, useNow, useRemPx } from "@/lib/use-field";

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

const presenceWord = (a: Activity) =>
  a.neverSpoke ? "pole veel rääkinud" : a.state === "active" ? "räägib praegu" : a.state === "recent" ? "rääkis hiljuti" : a.state === "quiet" ? "vaikib" : "vaikib pikalt";

function FieldPage() {
  const { speakers, utterances, lastSpokeAt, running, deleted } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(fieldRef);
  const rem = useRemPx();
  const tick = useNow(1000);
  // a sentence that has just arrived counts immediately, not at the next tick
  const now = Math.max(tick, ...Object.values(lastSpokeAt));
  const crowded = speakers.length > 8;
  const phone = size.w > 0 && size.w < PHONE_MAX_W;

  // Captions are placed as a whole: no caption may cover another caption or any name.
  // On a phone only, quiet people are also left off the field when an active speaker needs the room;
  // `hiding` carries who is hidden (and since when) from one pass to the next.
  const preferred = useRef<Record<string, string>>({});
  const hiding = useRef<HidingState>(NO_HIDING);
  const field = useMemo(
    () => layoutField({ speakers, utterances, lastSpokeAt, now, size, rem, prefer: preferred.current, hiding: phone ? hiding.current : null }),
    [speakers, utterances, lastSpokeAt, now, size, rem, phone],
  );
  const { activity, placements, lines } = field;
  const hidden = field.hiding?.hidden ?? {};
  useEffect(() => {
    preferred.current = Object.fromEntries(Object.values(field.placements).flatMap((p) => (p ? [[p.id, p.key]] : [])));
    hiding.current = field.hiding ?? NO_HIDING;
  }, [field]);

  const nameOf = (id: string) => speakers.find((s) => s.id === id)?.name ?? "Tundmatu";
  return (
    <div className="relative flex flex-1 flex-col">
      <h1 className="sr-only">Kõneväli</h1>

      {/* Shared spatial field — mist gathers where voices are; names hold their place */}
      <div ref={fieldRef} className="relative min-h-[72vh] flex-1" role="application" aria-label="Vestlusväli: osalejate asukohad" aria-describedby="vali-help">
        <span id="vali-help" className="sr-only">Liiguta nime nooleklahvidega, Shift-klahviga suurem samm. Asukoht jääb püsima.</span>
        {speakers.filter((s) => !hidden[s.id]).map((s) => (
          <PresenceName key={s.id} s={s} act={activity.get(s.id)!} fieldRef={fieldRef} crowded={crowded} />
        ))}
        <CaptionLayer placements={placements} lines={lines} activity={activity} now={now} rem={rem} />
        {/* Screen readers get every sentence here, whether or not it fits on screen */}
        <div role="log" aria-live="polite" aria-label="Viimased laused" className="sr-only">
          {utterances.slice(-5).map((u) => <p key={u.id}>{nameOf(u.speakerId)}: {u.text}</p>)}
        </div>
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

function PresenceName({ s, act, fieldRef, crowded }: { s: Speaker; act: Activity; crowded: boolean; fieldRef: React.RefObject<HTMLDivElement | null> }) {
  const drag = useRef(false);
  const glow = colorGlow[s.color];
  const p = act.presence;
  const active = act.state === "active";
  const marker = act.state === "marker";
  const move = (x: number, y: number) => actions.updateSpeaker(s.id, { x: Math.min(94, Math.max(6, x)), y: Math.min(85, Math.max(6, y)) });
  return (
    <div
      role="button" tabIndex={0} id={`nimi-valjal-${s.id}`}
      aria-label={`${s.name}, ${presenceWord(act)}`}
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
      style={{ left: `${s.x}%`, top: `${s.y}%`, touchAction: "none", ...(marker ? {} : { zIndex: Math.round(p * 10) }) }}
      className={`group absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none rounded-md active:cursor-grabbing ${marker ? "flex size-7 items-center justify-center hover:z-40 focus-visible:z-40" : "px-2"}`}
    >
      {marker ? (
        <>
          {/* A long-silent voice shrinks to a dot but keeps its place; the name shows on hover or focus. */}
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: glow, opacity: 0.7, boxShadow: `0 0 12px ${glow}` }} />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded-sm bg-card/90 px-2 py-0.5 text-sm font-bold opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{s.name}</span>
        </>
      ) : (
        <>
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-all duration-[2400ms]"
            style={{ width: `${14 + p * 22}rem`, height: `${5 + p * 7}rem`, background: `radial-gradient(closest-side, ${glow}, transparent)`, filter: "blur(36px)", opacity: 0.12 + p * 0.5 }} />
          <span className="relative block whitespace-nowrap font-display font-bold transition-all duration-1000"
            style={{ fontSize: `${nameRem(act, crowded)}rem`, opacity: Math.max(0.55, 0.4 + p * 0.6), color: active ? glow : undefined }}>
            {s.name}
            {active && <span aria-hidden className="mx-auto mt-0.5 block h-0.5 w-2/3 rounded-full bg-foreground" />}
          </span>
        </>
      )}
    </div>
  );
}

/** Draws the blocks the layout engine placed; purely visual (screen readers use the log). */
function CaptionLayer({ placements, lines, activity, now, rem }: { placements: Record<string, Placement | null>; lines: Map<string, Utterance[]>; activity: Map<string, Activity>; now: number; rem: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Object.values(placements).map((p) => {
        if (!p) return null;
        const shown = lines.get(p.id)?.slice(0, p.keep) ?? [];
        const above = p.key.startsWith("above");
        const speaking = activity.get(p.id)?.state === "active";
        // newest sits closest to the name; older ones drift outward and fade
        const ordered = shown.map((u, i) => ({ u, i }));
        if (above) ordered.reverse();
        return (
          <ol key={p.id} data-caption-for={p.id} className="absolute flex flex-col text-center text-base" style={{ left: p.x, top: p.y, width: p.w, gap: CAPTION_ITEM_GAP, fontSize: `${p.scale}rem` }}>
            {ordered.map(({ u, i }) => (
              <li key={u.id} data-i={i} className={i === 0 && speaking ? "font-semibold" : "text-muted-foreground"}
                style={{ opacity: (EMPHASIS[i] ?? 0) * captionFade(now - u.at), transition: "opacity 1s ease", lineHeight: `${captionLinePx(rem * p.scale)}px`, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: shownLines(u.text, i, p.w, rem * p.scale), overflow: "hidden" }}>
                {u.text}
              </li>
            ))}
          </ol>
        );
      })}
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
