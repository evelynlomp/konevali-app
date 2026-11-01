import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { actions, useSession } from "@/lib/session-store";

export const Route = createFileRoute("/privaatsus")({
  head: () => ({
    meta: [
      { title: "Andmed ja privaatsus – Kõneväli" },
      { name: "description", content: "Millised andmed töödeldakse, kus ja kui kaua." },
      { property: "og:title", content: "Andmed ja privaatsus – Kõneväli" },
      { property: "og:description", content: "Mida see pilootversioon teeb ruumis räägitud kõnega." },
    ],
  }),
  component: PrivacyPage,
});

/** Set when building (VITE_CONTACT, VITE_HOSTING): who answers questions and where the server runs. */
const CONTACT: string = import.meta.env["VITE_CONTACT"] ?? "Küsi testi korraldajalt (kontakt ei ole seadistatud).";
const HOSTING: string = import.meta.env["VITE_HOSTING"] ?? "Serveri piirkond ei ole seadistatud.";

function PrivacyPage() {
  const { audit, utterances, speakers } = useSession();
  const [msg, setMsg] = useState("");

  const exportData = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ speakers, utterances, audit }, null, 2)], { type: "application/json" }));
    a.download = "minu-andmed.json";
    a.click();
    actions.log("Seansi andmed laaditi alla.");
    setMsg("Andmed laaditi alla.");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Andmed ja privaatsus</h1>
        <p className="max-w-prose text-lg">See on pilootkatse, mitte avalik teenus. Siin on kirjas, mida see versioon päriselt teeb.</p>
        <dl className="space-y-4 rounded-md border-2 border-border bg-card p-5">
          {[
            ["Kes vastutab?", CONTACT],
            [
              "Mida töödeldakse?",
              "Ruumis räägitu heli, reaalajas, tekstiks tegemiseks. Heli ei salvestata: server hoiab seda ainult mälus töötlemise ajaks. Server ei salvesta ka teksti. Tekst on ainult selle brauseri mälus, kuni lehe sulged või kustutad transkripti.",
            ],
            [
              "Nimed on valikulised",
              "Kõnevälja saab täisväärtuslikult kasutada ka ilma nimedeta: kogu tekst on siis ühe kõneleja all ja nime saad ise muuta. Nimed on vaikimisi väljas ja neid saab sisse lülitada ainult pärast eraldi nõusolekut.",
            ],
            [
              "Häälejälg (kui nimed on sees)",
              "Kes tahab nime, annab umbes 10-sekundilise häälenäite. Sellest tehakse arvuline häälejälg, mis on biomeetriline andmestik. Häälenäite heli visatakse minema kohe, kui häälejälg on tehtud. Häälejälg on ainult selle seansi serveri töömälus: kettale ei kirjutata ja logidesse ei panda. Kui häälejälgi on, hoiab server mälus ainult selle lause heli, mida pole veel nimetatud (lause pikkuse, kuni 30 sekundit), ja vaikuse ajal paar viimast sekundit. Kui lause on nimetatud, kustutatakse selle heli kohe.",
            ],
            ["Mida häälejälg ei ole", "See ei ole autentimine, identiteedi tõend, jälgimine, emotsiooni, vanuse, soo ega muude omaduste tuvastamine. Seda kasutatakse ainult nime kuvamiseks."],
            [
              "Teised ruumisolijad",
              "Nimede kuvamiseks võrdleb server iga lause häält häälejälgedega. See puudutab ka neid, kes häälenäidet ei andnud: nende häälest häälejälge ei tehta ega salvestata midagi. Kui süsteem ei ole kindel või lause on liiga lühike, jääb nimi puudu („Tundmatu”).",
            ],
            [
              "Eemaldamine ja kustumine",
              "Oma häälejälje saad igal ajal eemaldada („Eemalda profiil”). „Nimed välja” kustutab kõik häälejäljed kohe. Häälejäljed kustuvad ka siis, kui seansi lõpetad, lehe sulged või ühendus katkeb, ning kui leht ei saada serverile 15 minutit midagi.",
            ],
            ["Täpsus", "Nimi võib olla vale ning täpsust eri häälte puhul ei ole eraldi mõõdetud. Ära toetu nimedele olulistes otsustes."],
            [
              "Kus ja kellele?",
              `${HOSTING} Heli läheb ainult Kõnevälja serverisse. Kolmanda osapoole kõnetuvastust ei kasutata ja andmeid ei kasutata mudelite õpetamiseks. Serveri hostija võib logida tehnilisi päringuid (näiteks IP-aadress).`,
            ],
            [
              "Alus ja nõusolek",
              "Töötlemine toimub nõusoleku alusel. Kõik ruumisolijad (ainult täiskasvanud) peavad sellest teadma ja olema nõus. Nõusoleku saab igal ajal tagasi võtta nupuga „Peata”. Nõusolekuid ei salvesta see leht: korraldaja peab need ise fikseerima.",
            ],
            ["Kui kaua?", "Kuni lehe sulgemiseni või transkripti kustutamiseni. Seansi lõppedes ei jää serverisse midagi."],
            ["Tehisaru piirangud", "Tekst on masinloodud ja võib sisaldada vigu: sõnu võib puududa või olla valesti tuvastatud. Ära toetu sellele tervise, õiguse ega ohutuse otsustes."],
            [
              "Kasutatud mudelid",
              "Kõnetuvastus: TalTechNLP streaming-zipformer-large.et-en.w2n (Apache-2.0, Hugging Face). Nimede jaoks (kui need on sees): NVIDIA NeMo TitaNet-small (Apache-2.0, ONNX-teisendus k2-fsa/sherpa-onnx'ist). Mudeleid jooksutab sherpa-onnx.",
            ],
            ["Sinu õigused", "Võid küsida oma andmete kohta, nõuda nende kustutamist ja esitada kaebuse Andmekaitse Inspektsioonile (aki.ee)."],
          ].map(([t, d]) => (
            <div key={t}><dt className="font-bold">{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          <button onClick={exportData} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground">Laadi alla seansi andmed</button>
          <button onClick={() => { if (confirm("Kas kustutada kogu transkript jäädavalt?")) { actions.deleteTranscript(); setMsg("Transkript on kustutatud."); } }} className="min-h-11 rounded-md border-2 border-destructive px-4 font-bold text-destructive">Kustuta transkript</button>
        </div>
        <p role="status" className="font-bold text-primary">{msg}</p>
      </div>

      <section aria-labelledby="aj">
        <h2 id="aj" className="text-xl font-bold mb-3">Selle seansi tegevused</h2>
        <ol className="divide-y divide-border rounded-md border-2 border-border bg-card">
          {audit.map((a) => (
            <li key={a.id} className="flex gap-4 p-3"><time className="font-mono text-sm text-muted-foreground shrink-0">{a.time}</time><span>{a.text}</span></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
