import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kõneväli – Näe vestlust enda ümber" },
      { name: "description", content: "Kõneväli muudab vestluse nähtavaks elavaks väljaks, et igaüks saaks võrdselt osaleda." },
      { property: "og:title", content: "Kõneväli – Näe vestlust enda ümber" },
      { property: "og:description", content: "Vestlus muutub nähtavaks ruumis. Igaüks väärib olla osa vestlusest." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section aria-labelledby="pealkiri" className="aurora-field relative -mx-4 flex min-h-[70vh] flex-1 flex-col items-center justify-center overflow-hidden px-4 text-center">
        <div aria-hidden className="aurora-blob left-[8%] top-[12%] size-72" style={{ background: "var(--glow-teal)" }} />
        <div aria-hidden className="aurora-blob right-[6%] top-[30%] size-80" style={{ background: "var(--glow-petrol)", animationDelay: "-8s" }} />
        <div aria-hidden className="aurora-blob bottom-[8%] left-[30%] size-64" style={{ background: "var(--glow-forest)", animationDelay: "-16s" }} />

        <div className="relative">
          <h1 id="pealkiri" className="font-display text-6xl font-bold tracking-tight text-field-foreground sm:text-7xl">
            Kõneväli
          </h1>
          <p className="mt-4 text-2xl font-semibold text-field-foreground sm:text-3xl">
            Näe vestlust enda ümber.
          </p>
          <p className="mx-auto mt-6 max-w-xl text-lg text-field-soft">
            Kõneväli muudab kõne nähtavaks elavaks väljaks — iga hääl on valguspunkt,
            iga mõte leiab oma koha. Nii saavad kõik, ka kuulmispuudega inimesed,
            vestluses võrdselt kaasa rääkida.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/vali"
              className="inline-flex min-h-12 items-center rounded-full bg-glow-teal px-8 text-lg font-bold text-secondary shadow-lg transition-transform hover:scale-105"
            >
              Ava kõneväli
            </Link>
            <Link
              to="/privaatsus"
              className="inline-flex min-h-12 items-center rounded-full border-2 border-field-soft/50 px-8 font-semibold text-field-foreground hover:border-field-soft"
            >
              Kuidas andmeid kaitstakse
            </Link>
          </div>
        </div>
      </section>

      {/* Values */}
      <section aria-labelledby="vaartused" className="mx-auto max-w-4xl py-16">
        <h2 id="vaartused" className="text-center text-3xl font-bold">Igaüks väärib olla osa vestlusest.</h2>
        <ul className="mt-10 grid gap-10 sm:grid-cols-3">
          {[
            ["Vestlus kui valgus", "Kõnelejad ilmuvad väljale pehmete valguspunktidena. Näed kohe, kes räägib, ja vestluse voogu silmad jälgivad iseenesest."],
            ["Rahu, mitte tööriist", "Ühtegi tabelit, ruudustikku ega paneeli. Väli täidab ekraani ja juhtnupud jäävad tagaplaanile — tähelepanu kuulub inimestele."],
            ["Inimene otsustab", "Tehisaru aitab hääli eristada ja kokkuvõtteid teha, kuid kõike saab üle vaadata ja parandada. Andmed on sinu oma."],
          ].map(([t, d]) => (
            <li key={t}>
              <h3 className="text-xl font-bold text-primary">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
