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
              "Kõneväli töötleb ruumis räägitud heli reaalajas ja teeb selle tekstiks. Heli ei salvestata: server hoiab seda ainult mälus, kuni see on tekstiks tehtud. Server ei salvesta ka teksti. Tekst on ainult sinu brauseri mälus, kuni lehe sulged või transkripti kustutad. „Laadi alla” fail tekib sinu enda seadmes ja ainult siis, kui sa seda ise tahad. Leht ise ei kasuta küpsiseid ega salvesta midagi brauserisse.",
            ],
            [
              "Nimed on valikulised",
              "Kõnevälja saab täisväärtuslikult kasutada ka ilma nimedeta. Siis on kogu tekst ühe kõneleja all ja nime saad ise muuta. Nimed on alguses väljas. Neid saab sisse lülitada alles pärast eraldi nõusolekut.",
            ],
            [
              "Häälejälg (kui nimed on sees)",
              "Kes tahab, et tema nimi kuvataks, annab umbes 10-sekundilise häälenäite. Sellest tehakse häälejälg: arvud, mis kirjeldavad hääle omadusi. See on biomeetriline andmestik. Häälenäite heli kustutatakse kohe, kui häälejälg on valmis. Häälejälg on ainult serveri töömälus: seda ei kirjutata kettale ega logisse. Nimede ajal hoiab server mälus ka selle lause heli, mida ta pole veel nimetanud (kuni 30 sekundit), ja vaikuse ajal paar viimast sekundit. Kui lause on nimetatud, kustutatakse selle heli kohe.",
            ],
            [
              "Mida häälejälg ei ole",
              "Häälejälge kasutatakse ainult nime kuvamiseks. See ei ole sisselogimine, isiku tõendamine ega jälgimine, ja selle põhjal ei tuvastata emotsiooni, vanust, sugu ega muid omadusi.",
            ],
            [
              "Teised ruumisolijad",
              "Nimede kuvamiseks arvutab server iga lause häälest ajutise häälevektori ja võrdleb seda häälejälgedega. See toimub ka nende puhul, kes häälenäidet ei andnud. Nende vektorit ei salvestata ega kasutata millekski muuks, see kustutatakse kohe pärast võrdlust ja nende kohta häälejälge ei tehta. Kui server ei ole kindel või lause on liiga lühike, jääb nimi puudu („Tundmatu”).",
            ],
            [
              "Eemaldamine ja kustumine",
              "Oma häälejälje saad igal ajal eemaldada („Eemalda profiil”). „Nimed välja” kustutab kõik häälejäljed kohe. Häälejäljed kustuvad ka siis, kui seansi lõpetad, lehe sulged või ühendus katkeb, ja siis, kui leht ei saada serverile 15 minutit midagi.",
            ],
            ["Täpsus", "Nimi võib olla vale. Täpsust eri häälte puhul ei ole eraldi mõõdetud. Ära toetu nimedele olulistes otsustes."],
            [
              "Kus ja kellele?",
              `${HOSTING} Railway on USA ettevõte. Ühendus on krüpteeritud, aga liiklus läbib Railway võrku ja selle asukoht ei ole meie kontrolli all. Heli saadetakse Kõnevälja serverisse. Kolmanda osapoole kõnetuvastust ei kasutata ja andmeid ei kasutata mudelite õpetamiseks. Railway võib salvestada tehnilisi andmeid (näiteks IP-aadress).`,
            ],
            [
              "Alus ja nõusolek",
              "Töötlemine toimub nõusoleku alusel. Kõik ruumisolijad (ainult täiskasvanud) peavad sellest teadma ja olema nõus. Nõusoleku saab igal ajal tagasi võtta: ütle seda korraldajale ja vajuta nupule „Peata”. See leht ei salvesta nõusolekuid: korraldaja peab need ise kirja panema.",
            ],
            ["Kui kaua?", "Kuni lehe sulgemiseni või transkripti kustutamiseni. Kui seansi lõpetad, ei jää serverisse midagi."],
            [
              "Tehisaru piirangud",
              "Tekst on arvuti tehtud ja võib sisaldada vigu: sõnu võib puududa või olla valesti kuuldud. Ära toetu sellele tervise, õiguse ega ohutuse otsustes.",
            ],
            [
              "Kasutatud mudelid",
              "Kõnetuvastus: TalTechNLP streaming-zipformer-large.et-en.w2n (Apache-2.0, Hugging Face). Nimede jaoks (kui need on sees): NVIDIA NeMo TitaNet-small (Apache-2.0, k2-fsa/sherpa-onnx'i ONNX-teisendus). Mudeleid jooksutab sherpa-onnx.",
            ],
            [
              "Sinu õigused",
              "Sa võid küsida, mis andmeid sinu kohta töödeldakse, nõuda nende kustutamist, nõusoleku tagasi võtta ja esitada kaebuse Andmekaitse Inspektsioonile (aki.ee).",
            ],
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
