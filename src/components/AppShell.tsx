import { Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { actions, useSession } from "@/lib/session-store";

const NAV = [
  { to: "/", label: "Otseülekanne" },
  { to: "/transkript", label: "Transkript" },
  { to: "/ulevaade", label: "Kokkuvõte" },
  { to: "/privaatsus", label: "Andmed ja privaatsus" },
] as const;

export function AppShell() {
  const { running, deleted } = useSession();
  useEffect(() => {
    const t = setInterval(() => actions.tick(), 4000);
    const first = setTimeout(() => actions.tick(), 1200);
    return () => { clearInterval(t); clearTimeout(first); };
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#sisu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 bg-card px-4 py-2 font-bold">
        Liigu põhisisu juurde
      </a>
      <header className="border-b-4 border-primary bg-secondary text-secondary-foreground no-print">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link to="/" className="font-display text-2xl font-bold tracking-tight">
            Ruumi<span className="font-normal">Subtiitrid</span>
          </Link>
          <nav aria-label="Põhinavigatsioon" className="flex-1">
            <ul className="flex flex-wrap gap-1">
              {NAV.map((n) => (
                <li key={n.to}>
                  <Link
                    to={n.to}
                    className="inline-flex min-h-11 items-center px-4 font-semibold border-b-4 border-transparent hover:border-secondary-foreground/40"
                    activeProps={{ className: "border-secondary-foreground!", "aria-current": "page" }}
                    activeOptions={{ exact: true }}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p role="status" className="flex items-center gap-2 text-sm font-bold">
            <span aria-hidden className={`inline-block size-3 rounded-full ${running && !deleted ? "bg-live animate-pulse" : "bg-muted-foreground"}`} />
            {deleted ? "Andmed kustutatud" : running ? "Salvestab · osalejaid teavitatud" : "Peatatud"}
          </p>
        </div>
      </header>
      <main id="sisu" className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border py-4 text-center text-sm text-muted-foreground no-print">
        Tehisaru abistab kõnelejate tuvastamisel ja kokkuvõtetes. Kõiki tulemusi saab üle vaadata ja parandada.
      </footer>
    </div>
  );
}

export function AiBadge({ confidence }: { confidence?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-ai-foreground/40 bg-ai px-2 py-0.5 text-xs font-bold text-ai-foreground">
      <span aria-hidden>◆</span> Tehisaru loodud
      {confidence !== undefined && <span className="font-normal">· kindlus {confidence}%</span>}
    </span>
  );
}

export const colorBg: Record<string, string> = {
  teal: "bg-sp-teal", petrol: "bg-sp-petrol", forest: "bg-sp-forest",
  amber: "bg-sp-amber", sky: "bg-sp-sky", coral: "bg-sp-coral",
};
export const colorBorder: Record<string, string> = {
  teal: "border-sp-teal", petrol: "border-sp-petrol", forest: "border-sp-forest",
  amber: "border-sp-amber", sky: "border-sp-sky", coral: "border-sp-coral",
};
export const colorStroke: Record<string, string> = {
  teal: "var(--sp-teal)", petrol: "var(--sp-petrol)", forest: "var(--sp-forest)",
  amber: "var(--sp-amber)", sky: "var(--sp-sky)", coral: "var(--sp-coral)",
};
