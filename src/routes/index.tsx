import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kõneväli – Vestlus ei ole ainult sõnad" },
      { name: "description", content: "Kõneväli muudab vestluse nähtavaks elavaks väljaks, et igaüks saaks võrdselt osaleda." },
      { property: "og:title", content: "Kõneväli – Vestlus ei ole ainult sõnad" },
      { property: "og:description", content: "Vestlus muutub nähtavaks ruumis. Igaüks väärib olla osa vestlusest." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <section aria-labelledby="pealkiri" className="relative flex min-h-[78vh] flex-col items-start justify-center py-16">
        <p className="text-lg font-semibold text-primary">Kõneväli</p>
        <h1 id="pealkiri" className="mt-3 max-w-4xl font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
          Vestlus ei ole ainult sõnad.
        </h1>
        <p className="mt-6 max-w-2xl text-2xl leading-snug text-muted-foreground">
          See on kohalolu, tähelepanu ja hetked, mil keegi astub sõna võtma.
          Kõneväli teeb selle kõik nähtavaks — et sina oleksid vestluses päriselt kohal.
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link to="/vali" className="inline-flex min-h-12 items-center rounded-full bg-primary px-8 text-lg font-bold text-primary-foreground transition-transform hover:scale-105">
            Astu vestlusesse
          </Link>
          <Link to="/privaatsus" className="inline-flex min-h-12 items-center rounded-full border border-border px-8 font-semibold hover:bg-muted">
            Kuidas andmeid kaitstakse
          </Link>
        </div>
      </section>

      <section aria-labelledby="vaartused" className="relative pb-20">
        <h2 id="vaartused" className="max-w-3xl text-3xl font-bold leading-tight">
          Sa ei pea küsima, mida just öeldi. Sa näed, kuidas vestlus liigub — ja võid sellesse astuda.
        </h2>
        <ul className="mt-12 grid gap-10 sm:grid-cols-3">
          {[
            ["Kuuluvus", "Kes räägib, muutub nähtavamaks. Kes vaikib, rahuneb taustale. Tunned vestluse rütmi ilma, et peaksid seda arvama."],
            ["Väärikus", "Pikad mõtted jagunevad selgeteks sammudeks. Ei mingit tekstimüüri — saad jälgida, mitte tabada."],
            ["Võrdne ligipääs", "Tehisaru aitab, inimene otsustab. Kõike saab parandada ning andmed jäävad sinu omaks."],
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
