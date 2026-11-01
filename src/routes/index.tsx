import { createFileRoute, Link } from "@tanstack/react-router";
import { useSession } from "@/lib/session-store";
import { colorGlow } from "@/components/AppShell";
import { attentionRanks, EMPHASIS, presenceFromRank } from "@/lib/presence";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kõneväli – Näe, kes räägib. Mõista, mis toimub." },
      { name: "description", content: "Kõneväli muudab kõne nähtavaks ruumis: reaalajas subtiitrid iga kõneleja juures, võrdseks osalemiseks ja kirjutustõlkeks." },
      { property: "og:title", content: "Kõneväli – Näe, kes räägib. Mõista, mis toimub." },
      { property: "og:description", content: "Jälgi vestlust reaalajas — näed, kes räägib ja mida öeldakse." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <section aria-labelledby="pealkiri" className="relative grid min-h-[78vh] items-center gap-10 py-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h1 id="pealkiri" className="font-display text-6xl font-bold tracking-tight sm:text-7xl">Kõneväli</h1>
          <p className="mt-4 text-3xl font-semibold leading-tight text-primary sm:text-4xl">Näe, kes räägib. Mõista, mis toimub.</p>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted-foreground">
            Kõneväli kirjeldab vestluse reaalajas: iga kõneleja nimi on oma kohal ja iga lause ilmub just tema juurde. Tekst on selle seansi ajal saadaval transkriptina.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link to="/vali" className="inline-flex min-h-12 items-center rounded-full bg-primary px-8 text-lg font-bold text-primary-foreground transition-transform hover:scale-105">Astu vestlusesse</Link>
            <a href="#kuidas" className="inline-flex min-h-12 items-center rounded-full border border-border px-8 font-semibold hover:bg-muted">Kuidas see töötab</a>
          </div>
        </div>
        <MiniField />
      </section>

      <section id="kuidas" aria-labelledby="kuidas-pealkiri" className="relative scroll-mt-8 pb-16">
        <h2 id="kuidas-pealkiri" className="text-3xl font-bold">Kuidas see töötab</h2>
        <ol className="mt-8 grid gap-10 sm:grid-cols-3">
          {[
            ["1. Heli muutub tekstiks", "Ruumis räägitu tehakse reaalajas tekstiks. Selles versioonis ei eristata kõnelejaid: kogu tekst on ühe nime all, mida saad ise muuta."],
            ["2. Tekst ilmub väljale", "Iga lause ilmub nime juurde, kohe pärast ütlemist."],
            ["3. Tekst jääb sinu brauserisse", "Server ei salvesta midagi. Transkripti saad alla laadida või kustutada ning lehe sulgemisel see kaob."],
          ].map(([t, d]) => (
            <li key={t} className="border-l-2 border-primary/50 pl-5">
              <h3 className="text-xl font-bold text-primary">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="tulemused" className="relative pb-20">
        <h2 id="tulemused" className="max-w-3xl text-3xl font-bold leading-tight">
          Mida saad kohe teha
        </h2>
        <ul className="mt-12 grid gap-10 sm:grid-cols-3">
          {[
            ["Näed, mida öeldakse", "Rääkija nimi on väljal oma kohal ja tekst ilmub selle juurde."],
            ["Jälgid vestlust reaalajas", "Laused ilmuvad selles järjekorras, kui need öeldakse."],
            ["Saad transkripti", "Seansi tekst on loetav ja alla laaditav TXT-failina."],
          ].map(([t, d]) => (
            <li key={t} className="border-l-2 border-primary/50 pl-5">
              <h3 className="text-xl font-bold text-primary">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A living miniature of the real field — same voices, same fading traces. */
function MiniField() {
  const { speakers, utterances, activeId } = useSession();
  const rank = attentionRanks(utterances, activeId);
  return (
    <figure className="relative h-[26rem] sm:h-[30rem]" aria-label="Näide: nimed ja nende viimased laused vestlusväljal">
      <figcaption className="absolute inset-x-0 top-0 text-center text-sm font-semibold text-muted-foreground">Näide: väljamõeldud vestlus</figcaption>
      {speakers.slice(0, 8).map((s) => {
        const r = rank(s.id), p = presenceFromRank(r), glow = colorGlow[s.color];
        const lines = r < 2 ? utterances.filter((u) => u.speakerId === s.id).slice(r === 0 ? -2 : -1).reverse() : [];
        return (
          <div key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${s.x}%`, top: `${Math.min(80, s.y)}%` }}>
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-all duration-[2400ms]"
              style={{ width: `${8 + p * 12}rem`, height: `${3 + p * 4}rem`, background: `radial-gradient(closest-side, ${glow}, transparent)`, filter: "blur(28px)", opacity: 0.12 + p * 0.5 }} />
            <span className="relative block whitespace-nowrap font-display font-bold transition-all duration-1000" style={{ fontSize: `${0.95 + p * 0.3}rem`, opacity: 0.4 + p * 0.6, color: r === 0 ? glow : undefined }}>{s.name}</span>
            <ul className="relative mt-1 w-48 space-y-0.5 text-sm leading-snug">
              {lines.map((u, i) => <li key={u.id} className={`caption-in line-clamp-2 transition-opacity duration-1000 ${i === 0 && r === 0 ? "font-semibold" : "text-muted-foreground"}`} style={{ opacity: EMPHASIS[i + r] }}>{u.text}</li>)}
            </ul>
          </div>
        );
      })}
    </figure>
  );
}
