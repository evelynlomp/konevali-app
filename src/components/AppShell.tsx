import { Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { actions, useSession } from "@/lib/session-store";

const NAV = [
  { to: "/", label: "Avaleht" },
  { to: "/vali", label: "Kõneväli" },
  { to: "/transkript", label: "Transkript" },
  { to: "/ulevaade", label: "Kokkuvõte" },
  { to: "/privaatsus", label: "Privaatsus" },
] as const;

export function AppShell() {
  const { running, deleted } = useSession();
  useEffect(() => {
    const t = setInterval(() => actions.tick(), 4000);
    const first = setTimeout(() => actions.tick(), 1200);
    return () => { clearInterval(t); clearTimeout(first); };
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col overflow-x-clip aurora-field">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-blob left-[5%] top-[5%] size-[28rem]" style={{ background: "var(--glow-teal)", opacity: 0.18 }} />
        <div className="aurora-blob right-[0%] top-[40%] size-[32rem]" style={{ background: "var(--glow-petrol)", opacity: 0.16, animationDelay: "-9s" }} />
        <div className="aurora-blob bottom-[0%] left-[30%] size-[26rem]" style={{ background: "var(--glow-forest)", opacity: 0.14, animationDelay: "-17s" }} />
      </div>
      <a href="#sisu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 bg-card px-4 py-2 font-bold">
        Liigu põhisisu juurde
      </a>
      <header className="relative no-print">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link to="/" className="font-display text-2xl font-bold tracking-tight text-foreground">
            Kõne<span className="font-normal text-primary">väli</span>
          </Link>
          <nav aria-label="Põhinavigatsioon" className="flex-1">
            <ul className="flex flex-wrap gap-1">
              {NAV.map((n) => (
                <li key={n.to}>
                  <Link
                    to={n.to}
                    className="inline-flex min-h-11 items-center px-4 font-semibold border-b-2 border-transparent hover:border-foreground/30"
                    activeProps={{ className: "border-primary! text-primary", "aria-current": "page" }}
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
            {deleted ? "Andmed kustutatud" : running ? "Väli on elav" : "Peatatud"}
          </p>
        </div>
      </header>
      <main id="sisu" className="relative flex-1 mx-auto w-full max-w-7xl px-4 py-6 flex flex-col">
        <Outlet />
      </main>
      <footer className="relative py-4 text-center text-sm text-muted-foreground no-print">
        Kõneväli teeb vestluse nähtavaks, et kõik saaksid võrdselt osaleda. Tehisaru abistab — inimene kontrollib.
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
export const colorGlow: Record<string, string> = {
  teal: "var(--glow-teal)", petrol: "var(--glow-petrol)", forest: "var(--glow-forest)",
  amber: "var(--glow-amber)", sky: "var(--glow-sky)", coral: "var(--glow-coral)",
};
