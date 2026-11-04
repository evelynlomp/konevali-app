import { useEffect, useRef, useState } from "react";
import { actions, useSession, type Speaker } from "@/lib/session-store";
import type { EnrollFailure } from "@/lib/speech";
import { useNames } from "@/lib/speech/use-names";

/** A voice sample of about this many seconds; "Valmis" appears after MIN, and it ends by itself at MAX. */
const SAMPLE_MIN_S = 8;
const SAMPLE_MAX_S = 12;

const FAILURE_TEXT: Record<EnrollFailure, string> = {
  too_little: "Kõnet oli liiga vähe. Proovi uuesti ja räägi järjest umbes 10 sekundit.",
  inconsistent: "Näites oli mitu häält või liiga palju müra. Proovi uuesti vaikses kohas, nii et räägib ainult üks inimene.",
  limit: "Häälejälgi on juba liiga palju. Eemalda mõni profiil.",
  bad_id: "Selle osalejaga ei saa häälenäidet anda.",
  unavailable: "Häälenäidet ei saanud võtta. Kontrolli, et nimed on sees ja ühendus töötab.",
};

const prints = (n: number) => `${n} ${n === 1 ? "häälejälg" : "häälejälge"}`;

/**
 * Names for this session, at the top of the participants panel: off (a full alternative), the consent step before
 * they go on, and, while on, what the server holds and the way to delete it all at once.
 */
export function NamesStatus() {
  const { control, state } = useNames();
  const { namesRequested } = useSession();
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // once names switch on or off the request has been answered (not on the first render: the panel may open because of it)
  const wasOn = useRef(state.on);
  useEffect(() => {
    if (wasOn.current === state.on) return;
    wasOn.current = state.on;
    actions.requestNames(false);
    setAsking(false);
    setAgreed(false);
  }, [state.on]);

  if (!control || !state.known) return null;
  if (!state.available) {
    return <p className="mb-3 rounded-md border border-border p-3">Nimed ei ole selles serveris saadaval. Kõneväli töötab ilma nimedeta.</p>;
  }
  if (state.on) {
    return (
      <div className="mb-3 rounded-md border border-border p-4">
        <p role="status" className="font-semibold">Nimed on sees: {prints(state.ids.length)}, need kustuvad seansi lõpus.</p>
        <p className="mt-1 text-sm text-muted-foreground">„Nimed välja” kustutab kõik häälejäljed kohe.</p>
        <button onClick={() => control.setNames(false)} className="mt-3 min-h-11 rounded-md border-2 border-border px-4 font-semibold hover:bg-muted">
          Nimed välja
        </button>
      </div>
    );
  }
  const consenting = asking || namesRequested;
  return (
    <div className="mb-3 rounded-md border border-border p-4">
      <h3 className="font-bold">Nimed on väljas</h3>
      <p className="mt-1">Kogu tekst on ühe kõneleja all, mille nime saad ise muuta. See on täisväärtuslik viis Kõnevälja kasutada.</p>
      {!consenting ? (
        <button onClick={() => setAsking(true)} className="mt-3 min-h-11 rounded-md border-2 border-border px-4 font-semibold hover:bg-muted">
          Lülita nimed sisse
        </button>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (agreed) control.setNames(true);
          }}
        >
          <h4 className="font-bold">Enne nimede sisselülitamist</h4>
          <ul className="list-disc space-y-1 pl-6">
            <li>Nime saavad ainult need, kes ise annavad umbes 10-sekundilise häälenäite.</li>
            <li>Häälenäitest tehakse arvuline häälejälg. See on biomeetriline andmestik. Heli ei salvestata ja häälejälg on ainult selle seansi serveri mälus.</li>
            <li>Häälejälg kustub, kui eemaldad osaleja profiili, lülitad nimed välja või seansi lõpetad.</li>
            <li>Häälejälge kasutatakse ainult nime kuvamiseks: mitte autentimiseks, jälgimiseks ega hääle omaduste (emotsioon, vanus, sugu) tuvastamiseks.</li>
            <li>Nimede kuvamiseks arvutab server iga lause häälest ajutise häälevektori ja võrdleb seda häälejälgedega. See toimub ka nende puhul, kes häälenäidet ei andnud: nende vektorit ei salvestata ja see kustutatakse kohe pärast võrdlust.</li>
            <li>Nimi võib olla vale. Kui süsteem ei ole kindel, jääb nimi puudu.</li>
          </ul>
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-5 accent-primary" />
            <span>Kõik, kelle hääl selles ruumis kostub, on sellega nõus.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={!agreed} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">Lülita nimed sisse</button>
            <button
              type="button"
              onClick={() => {
                actions.requestNames(false);
                setAsking(false);
              }}
              className="min-h-11 rounded-md border-2 border-border px-4 font-semibold hover:bg-muted"
            >
              Jäta nimeta
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** One participant's voice print: agreeing, giving the sample, and removing the print. Only while names are on. */
export function VoiceSample({ s }: { s: Speaker }) {
  const { control, state } = useNames();
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "recording" | "processing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [failure, setFailure] = useState<EnrollFailure | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const recording = useRef(false);

  const finish = async () => {
    if (!control) return;
    clearInterval(timer.current);
    recording.current = false;
    setPhase("processing");
    const result = await control.enrollFinish(s.id);
    setPhase("idle");
    if (result.ok) {
      setAgreed(false);
      setFailure(null);
      actions.log(`Osaleja „${s.name}” andis häälenäite.`);
    } else setFailure(result.reason);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (phase === "recording" && seconds >= SAMPLE_MAX_S) void finishRef.current();
  }, [phase, seconds]);
  // a sample that is still being taken when the row goes away is thrown away
  useEffect(
    () => () => {
      clearInterval(timer.current);
      if (recording.current) control?.enrollCancel();
    },
    [control],
  );

  if (!control || !state.on || s.id === "Tundmatu") return null;

  if (state.ids.includes(s.id)) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span role="status" className="font-semibold">Häälejälg on olemas.</span>
        <button onClick={() => control.removeProfile(s.id)} className="min-h-11 rounded-md border border-border px-3 font-semibold hover:bg-muted">
          Eemalda profiil
        </button>
      </div>
    );
  }
  if (phase === "recording" || phase === "processing") {
    return (
      <div className="space-y-2">
        <p role="status" className="font-semibold">
          {phase === "processing" ? "Töötlen häälenäidet…" : `Räägi tavalise häälega umbes 10 sekundit, näiteks kirjelda oma päeva. Teised ei räägi sel ajal. (${seconds} s)`}
        </p>
        {phase === "recording" && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void finish()} disabled={seconds < SAMPLE_MIN_S} className="min-h-11 rounded-md bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50">
              Valmis
            </button>
            <button
              onClick={() => {
                clearInterval(timer.current);
                recording.current = false;
                control.enrollCancel();
                setPhase("idle");
              }}
              className="min-h-11 rounded-md border border-border px-4 font-semibold hover:bg-muted"
            >
              Katkesta
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-5 accent-primary" />
        <span>Nõustun, et minu häälenäitest tehakse selle seansi ajaks häälejälg.</span>
      </label>
      <button
        disabled={!agreed || state.enrolling !== null}
        onClick={() => {
          setFailure(null);
          if (!control.enrollStart(s.id)) return setFailure("unavailable");
          recording.current = true;
          setSeconds(0);
          setPhase("recording");
          timer.current = setInterval(() => setSeconds((n) => n + 1), 1000);
        }}
        className="min-h-11 rounded-md border-2 border-border px-4 font-semibold hover:bg-muted disabled:opacity-50"
      >
        Anna häälenäide
      </button>
      {failure && <p role="alert" className="font-semibold">{FAILURE_TEXT[failure]}</p>}
    </div>
  );
}
