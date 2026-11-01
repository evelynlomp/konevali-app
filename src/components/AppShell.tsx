import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { actions, useSession } from "@/lib/session-store";
import { createSpeechSource, sourceMode, type SourceProblem } from "@/lib/speech";
import { SpeechSourceContext } from "@/lib/speech/use-names";

const NAV = [
  { to: "/", label: "Avaleht" },
  { to: "/vali", label: "Kõneväli" },
  { to: "/transkript", label: "Transkript" },
  { to: "/privaatsus", label: "Privaatsus" },
] as const;

/** Said plainly and only when something is wrong; nothing is shown while all is well. */
const PROBLEM_TEXT: Record<SourceProblem, string> = {
  mic: "Mikrofoni ei leitud või selle kasutamine ei ole lubatud. Luba mikrofon brauseri aadressiribal.",
  "no-audio": "Heli ei jõua Kõneväljani. Kontrolli, et mikrofon on ühendatud ja sisse lülitatud.",
  unreachable: "Serveriga ei saanud ühendust.",
  connection: "Ühendus serveriga katkes.",
  busy: "Server on hõivatud. Proovi mõne minuti pärast.",
  refused: "Juurdepääsuvõti puudub või ei sobi. Ava link, mis sisaldab võtit.",
};

export function AppShell() {
  const { running, deleted, sessionId } = useSession();
  // set after mounting, so the server-rendered page and the first browser render agree
  const [mode, setMode] = useState<ReturnType<typeof sourceMode> | null>(null);
  const [problem, setProblem] = useState<SourceProblem | null>(null);
  // the microphone only starts once the user has said that everyone in the room has been told
  const [told, setTold] = useState(false);
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  useEffect(() => setMode(sourceMode()), []);
  // A new session gets a fresh source; pausing only stops it, so it resumes in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId is the intentional reset trigger
  const source = useMemo(() => createSpeechSource(), [sessionId]);
  // A replay or the microphone brings its own speakers, so the demo's starting four must not stay on the field.
  useEffect(() => {
    if (sourceMode() !== "demo") actions.clearSpeakers();
  }, []);
  useEffect(() => source.subscribe(actions.ingest), [source]);
  useEffect(() => {
    setProblem(null);
    return source.subscribeProblems?.(setProblem);
  }, [source]);
  useEffect(() => {
    if (!running || deleted) return;
    if (source.requiresConsent && !told) return;
    source.start();
    return () => source.stop();
  }, [source, running, deleted, told]);
  const waitingForConsent = mode === "live" && !told && running && !deleted;

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
          <p role="status" className="text-sm font-bold">
            {deleted ? "Andmed kustutatud" : running ? "" : "Peatatud"}
          </p>
        </div>
      </header>
      {mode === "demo" && (
        <p className="relative text-center text-sm font-semibold text-muted-foreground">Näide: väljamõeldud vestlus, mitte päris kõne.</p>
      )}
      {problem && (
        <div role="alert" className="relative mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-2">
          <p className="rounded-md border-2 border-border bg-card px-4 py-3 text-lg font-semibold">{PROBLEM_TEXT[problem]}</p>
          {problem !== "refused" && (
            <button onClick={() => source.retry?.()} className="min-h-11 rounded-full border border-border px-5 font-semibold hover:bg-muted">
              Proovi uuesti
            </button>
          )}
        </div>
      )}
      {waitingForConsent && (
        <section aria-labelledby="enne-alustamist" className="relative mx-auto w-full max-w-3xl px-4 py-6">
          <div className="rounded-md border-2 border-border bg-card p-6">
            <h2 id="enne-alustamist" className="text-2xl font-bold">Enne alustamist</h2>
            <p className="mt-3 text-lg">
              Kõneväli muudab ruumis räägitu tekstiks. Heli saadetakse töötlemiseks serverisse ja seda ei salvestata. Tekst jääb ainult selle brauseri mällu.
            </p>
            <p className="mt-3 text-lg">
              Kõik ruumisolijad peavad sellest teadma ja olema nõus (ainult täiskasvanud). Nõusoleku saab igal ajal tagasi võtta nupuga „Peata”.
            </p>
            <p className="mt-3 text-lg">Tekst on automaatne ja võib sisaldada vigu. Ära toetu sellele tervise, õiguse ega ohutuse otsustes.</p>
            <p className="mt-3 text-lg">
              Nimed on valikulised: Kõnevälja saab täisväärtuslikult kasutada ka ilma. Nimedega töötamiseks küsitakse järgmisel sammul eraldi nõusolekut.
            </p>
            <p className="mt-3">
              <Link to="/privaatsus" className="font-semibold underline">Andmed ja privaatsus</Link>
            </p>
            <p className="mt-4 font-semibold">Kõik ruumisolijad on sellest teavitatud ja nõus.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button onClick={() => setTold(true)} className="min-h-12 rounded-full border-2 border-primary px-6 text-lg font-bold text-primary hover:bg-muted">
                Alusta ilma nimedeta
              </button>
              <button
                onClick={() => {
                  actions.requestNames();
                  setTold(true);
                  if (pathname !== "/vali") void navigate({ to: "/vali" });
                }}
                className="min-h-12 rounded-full border-2 border-primary px-6 text-lg font-bold text-primary hover:bg-muted"
              >
                Alusta nimedega
              </button>
            </div>
          </div>
        </section>
      )}
      <main id="sisu" className="relative flex-1 mx-auto w-full max-w-7xl px-4 py-6 flex flex-col">
        <SpeechSourceContext.Provider value={source}>
          <Outlet />
        </SpeechSourceContext.Provider>
      </main>
      <footer className="relative py-4 text-center text-sm text-muted-foreground no-print">
        Tekst on automaatne ja võib eksida. Ära toetu sellele tervise, õiguse ega ohutuse otsustes.
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
