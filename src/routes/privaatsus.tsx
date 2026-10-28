import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { actions, useSession } from "@/lib/session-store";

export const Route = createFileRoute("/privaatsus")({
  head: () => ({
    meta: [
      { title: "Andmed ja privaatsus – Kõneväli" },
      { name: "description", content: "Millised andmed kogutakse, miks, kui kaua neid hoitakse ja muudatuste ajalugu." },
      { property: "og:title", content: "Andmed ja privaatsus – Kõneväli" },
      { property: "og:description", content: "Läbipaistev ülevaade andmetöötlusest ja tehisaru kasutamisest." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { audit, utterances, speakers } = useSession();
  const [retention, setRetention] = useState("seansi lõpus");
  const [msg, setMsg] = useState("");

  const exportData = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ speakers, utterances, audit }, null, 2)], { type: "application/json" }));
    a.download = "minu-andmed.json";
    a.click();
    actions.log("Isikuandmed eksporditi.");
    setMsg("Andmed laaditi alla.");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Andmed ja privaatsus</h1>
        <dl className="space-y-4 rounded-md border-2 border-border bg-card p-5">
          {[
            ["Mida kogume?", "Kõne heli teisendatakse tekstiks. Heli ennast ei salvestata."],
            ["Miks?", "Ainult selleks, et kuvada subtiitreid ja kõnelejate asukohta."],
            ["Kus kasutatakse?", "Andmeid töödeldakse Euroopa Liidus ja neid ei kasutata mudelite õpetamiseks."],
            ["Mida teeb tehisaru?", "Eristab kõnelejaid, pakub nimesid ja koostab kokkuvõtte. Kõik on tähistatud ning inimene saab neid muuta."],
          ].map(([t, d]) => (
            <div key={t}><dt className="font-bold">{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>

        <fieldset className="rounded-md border-2 border-border bg-card p-5">
          <legend className="px-1 text-lg font-bold">Säilitamine</legend>
          {["seansi lõpus", "7 päeva pärast", "30 päeva pärast"].map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-3">
              <input type="radio" name="sail" className="size-5 accent-primary" checked={retention === r}
                onChange={() => { setRetention(r); actions.log(`Säilitusaeg muudeti: kustutatakse ${r}.`); setMsg(`Säilitusaeg salvestatud: ${r}.`); }} />
              Kustuta {r}{r === "seansi lõpus" && " (vaikimisi)"}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button onClick={exportData} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">Laadi alla minu andmed</button>
          <button onClick={() => { if (confirm("Kas kustutada kogu transkript jäädavalt?")) { actions.deleteTranscript(); setMsg("Transkript on kustutatud."); } }} className="min-h-11 rounded-md border-2 border-destructive px-4 font-bold text-destructive">Kustuta transkript</button>
        </div>
        <p role="status" className="font-bold text-primary">{msg}</p>
      </div>

      <section aria-labelledby="aj">
        <h2 id="aj" className="text-xl font-bold mb-3">Muudatuste ajalugu</h2>
        <ol className="divide-y divide-border rounded-md border-2 border-border bg-card">
          {audit.map((a) => (
            <li key={a.id} className="flex gap-4 p-3"><time className="font-mono text-sm text-muted-foreground shrink-0">{a.time}</time><span>{a.text}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
