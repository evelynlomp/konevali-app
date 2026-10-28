import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { actions, useSession } from "@/lib/session-store";
import { AiBadge } from "@/components/AppShell";

export const Route = createFileRoute("/ulevaade")({
  head: () => ({
    meta: [
      { title: "Kokkuvõte – Kõneväli" },
      { name: "description", content: "Vestluse teemad, otsused ja tegevused – üle vaadatav ja muudetav kokkuvõte." },
      { property: "og:title", content: "Kokkuvõte – Kõneväli" },
      { property: "og:description", content: "Vestluse teemad, otsused ja tegevused selges eesti keeles." },
    ],
  }),
  component: InsightsPage,
});

type Status = "ootel" | "kinnitatud" | "tagasi lükatud";
interface Item { id: string; text: string; confidence: number; source: string; status: Status }

const initialSummary = "Koosolekul arutati Tallinna kontori kulude kasvu ja Tartu koolituste rahastamist. Lepiti kokku, et alates novembrist lisatakse igale koosolekule vaikimisi subtiitrid.";

function InsightsPage() {
  const { utterances } = useSession();
  const [summary, setSummary] = useState(initialSummary);
  const [editing, setEditing] = useState(false);
  const [human, setHuman] = useState(false);
  const [items, setItems] = useState<Item[]>([
    { id: "o1", text: "Alates novembrist lisatakse igale koosolekule subtiitrid.", confidence: 91, source: "Mari: „Otsustame, et alates novembrist teeme nii.”", status: "ootel" },
    { id: "t1", text: "Koostada eelarve täpsem ülevaade järgmiseks reedeks.", confidence: 84, source: "Kõneleja 4: „Ma võin koostada täpsema ülevaate…”", status: "ootel" },
    { id: "t2", text: "Kanda otsus protokolli.", confidence: 72, source: "Kõneleja 4: „Panen selle protokolli kirja.”", status: "ootel" },
  ]);
  const setStatus = (id: string, status: Status) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
    actions.log(`Tehisaru ettepanek ${status === "kinnitatud" ? "kinnitati" : "lükati tagasi"}.`);
  };

  if (utterances.length < 3)
    return <p className="rounded-md border-2 border-dashed border-border p-8 text-center text-lg text-muted-foreground">Kokkuvõtte koostamiseks on vaja rohkem kõnet. Tule tagasi, kui seanss on kestnud veidi kauem.</p>;

  const sentiment = [2, 3, 3, 4, 3, 4, 5];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Kokkuvõte</h1>
        <p className="text-muted-foreground max-w-prose">Kokkuvõtte koostas tehisaru transkripti põhjal. See on abivahend: kontrolli, paranda ja kinnita enne jagamist.</p>
      </div>

      <section aria-labelledby="k" className="rounded-md border-2 border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="k" className="text-xl font-bold">Lühikokkuvõte</h2>
          {human ? <span className="rounded-sm border border-primary px-2 py-0.5 text-xs font-bold text-primary">✎ Inimese muudetud</span> : <AiBadge confidence={88} />}
        </div>
        {editing ? (
          <form className="mt-3" onSubmit={(e) => { e.preventDefault(); setEditing(false); setHuman(true); actions.log("Kokkuvõtet muudeti käsitsi."); }}>
            <label htmlFor="sum" className="sr-only">Kokkuvõtte tekst</label>
            <textarea id="sum" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full rounded-md border-2 border-input bg-background p-3" />
            <button className="mt-2 min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">Salvesta muudatused</button>
          </form>
        ) : (
          <>
            <p className="mt-3 text-lg max-w-prose">{summary}</p>
            <button onClick={() => setEditing(true)} className="mt-3 min-h-11 rounded-md border-2 border-secondary px-4 font-bold">Muuda kokkuvõtet</button>
          </>
        )}
      </section>

      <section aria-labelledby="ot">
        <h2 id="ot" className="text-xl font-bold mb-3">Otsused ja tegevused</h2>
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-md border-2 border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{it.id.startsWith("o") ? "Otsus" : "Tegevus"}</span>
                <AiBadge confidence={it.confidence} />
                <span className="text-sm font-bold">Olek: {it.status}</span>
              </div>
              <p className="mt-2 text-lg">{it.text}</p>
              <p className="mt-1 text-sm text-muted-foreground">Miks see tuvastati? Allikas – {it.source}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setStatus(it.id, "kinnitatud")} aria-pressed={it.status === "kinnitatud"} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">✓ Kinnita</button>
                <button onClick={() => setStatus(it.id, "tagasi lükatud")} aria-pressed={it.status === "tagasi lükatud"} className="min-h-11 rounded-md border-2 border-destructive px-4 font-bold text-destructive">✕ Lükka tagasi</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="m" className="grid gap-4 md:grid-cols-2">
        <h2 id="m" className="sr-only">Mainitud teemad ja nimed</h2>
        {[
          ["Peamised teemad", ["Eelarve", "Kontorikulud", "Koolitused", "Subtiitrite kasutamine"]],
          ["Mainitud inimesed", ["Mari", "Jaan", "Evelyn"]],
          ["Mainitud asutused", ["Töötukassa"]],
          ["Mainitud kohad", ["Tallinn", "Tartu"]],
        ].map(([title, list]) => (
          <div key={title as string} className="rounded-md border-2 border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{title}</h3><AiBadge /></div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {(list as string[]).map((x) => <li key={x} className="rounded-sm bg-accent px-3 py-1 text-accent-foreground">{x}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="h" className="rounded-md border-2 border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2"><h2 id="h" className="text-xl font-bold">Meeleolu kulg</h2><AiBadge confidence={65} /></div>
        <p className="mt-2 max-w-prose">Arutelu algas neutraalselt ja muutus lõpu poole üha positiivsemaks, kui jõuti ühise otsuseni.</p>
        <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label="Meeleolu skaalal 1–5: 2, 3, 3, 4, 3, 4, 5. Suund on tõusev.">
          {sentiment.map((v, i) => <div key={i} className="flex-1 rounded-t-sm bg-primary" style={{ height: `${v * 20}%` }} />)}
        </div>
        <div className="mt-1 flex justify-between text-sm text-muted-foreground"><span>Algus</span><span>Lõpp</span></div>
      </section>
    </div>
  );
}
