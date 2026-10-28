import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { actions, useSession } from "@/lib/session-store";
import { colorBg } from "@/components/AppShell";

export const Route = createFileRoute("/transkript")({
  head: () => ({
    meta: [
      { title: "Transkript – Kõneväli" },
      { name: "description", content: "Vestluse täielik transkript kõnelejate kaupa, ekspordi TXT või PDF-ina." },
      { property: "og:title", content: "Transkript – Kõneväli" },
      { property: "og:description", content: "Vestluse transkript kõnelejate ja ajatemplitega." },
    ],
  }),
  component: TranscriptPage,
});

function TranscriptPage() {
  const { speakers, utterances } = useSession();
  const [msg, setMsg] = useState("");
  const name = (id: string) => speakers.find((s) => s.id === id)?.name ?? "Tundmatu";

  // group consecutive utterances by speaker
  const groups: { speakerId: string; items: typeof utterances }[] = [];
  utterances.forEach((u) => {
    const last = groups[groups.length - 1];
    if (last && last.speakerId === u.speakerId) last.items.push(u);
    else groups.push({ speakerId: u.speakerId, items: [u] });
  });

  const exportTxt = () => {
    const txt = utterances.map((u) => `[${u.time}] ${name(u.speakerId)}: ${u.text}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
    a.download = "transkript.txt";
    a.click();
    actions.log("Transkript eksporditi TXT-failina.");
    setMsg("Transkript laaditi alla TXT-failina.");
  };

  return (
    <section aria-labelledby="t">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="t" className="text-3xl font-bold">Transkript</h1>
          <p className="text-muted-foreground">{utterances.length} lõiku · {speakers.length} kõnelejat</p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <button disabled={!utterances.length} onClick={exportTxt} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">Laadi alla TXT</button>
          <button disabled={!utterances.length} onClick={() => { actions.log("Transkript eksporditi PDF-ina."); window.print(); }} className="min-h-11 rounded-md border-2 border-secondary px-4 font-bold disabled:opacity-50">Salvesta PDF-ina</button>
          <button disabled={!utterances.length} onClick={() => { if (confirm("Kas kustutada kogu transkript jäädavalt?")) { actions.deleteTranscript(); setMsg("Transkript on kustutatud."); } }} className="min-h-11 rounded-md border-2 border-destructive px-4 font-bold text-destructive disabled:opacity-50">Kustuta transkript</button>
        </div>
      </div>
      <p role="status" className="mb-4 font-bold text-primary">{msg}</p>

      <details className="mb-6 rounded-md border-2 border-border bg-card p-4 no-print">
        <summary className="cursor-pointer font-bold min-h-11 flex items-center">Paranda kõnelejate nimesid</summary>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {speakers.map((s) => (
            <li key={s.id}>
              <label htmlFor={`n-${s.id}`} className="block text-sm font-bold">Kõneleja {s.id.slice(1)}</label>
              <input id={`n-${s.id}`} defaultValue={s.name} onBlur={(e) => actions.rename(s.id, e.target.value)}
                className="min-h-11 w-full rounded-md border-2 border-input bg-background px-3" />
            </li>
          ))}
        </ul>
      </details>

      {groups.length === 0 ? (
        <p className="rounded-md border-2 border-dashed border-border p-8 text-center text-lg text-muted-foreground">Transkript on tühi. Kõne ilmub siia, kui seanss käib.</p>
      ) : (
        <ol className="space-y-4">
          {groups.map((g) => {
            const s = speakers.find((x) => x.id === g.speakerId);
            return (
              <li key={g.items[0]!.id} className="flex gap-4 rounded-md border border-border bg-card p-4">
                <span aria-hidden className={`w-1.5 shrink-0 rounded-sm ${colorBg[s?.color ?? "teal"]}`} />
                <div className="flex-1">
                  <h2 className="font-bold text-lg">{name(g.speakerId)}</h2>
                  {g.items.map((u) => (
                    <p key={u.id} className="mt-1">
                      <time className="mr-3 font-mono text-sm text-muted-foreground">{u.time}</time>{u.text}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
