import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NamesStatus, VoiceSample } from "@/components/NamesPanel";
import { actions, type Speaker } from "@/lib/session-store";
import type { EnrollResult, NamesControl, NamesState, SpeechSource } from "@/lib/speech";
import { SpeechSourceContext } from "@/lib/speech/use-names";

const mari: Speaker = { id: "p1", name: "Mari", color: "teal", x: 10, y: 10, large: false, pinned: false, nameSource: "kasutaja" };

function fakeSource(initial: Partial<NamesState> = {}) {
  let state: NamesState = { known: true, available: true, on: false, ids: [], enrolling: null, ...initial };
  const listeners = new Set<() => void>();
  const control = {
    state: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setNames: vi.fn(),
    enrollStart: vi.fn(() => true),
    enrollFinish: vi.fn(async (): Promise<EnrollResult> => ({ ok: true, seconds: 10 })),
    enrollCancel: vi.fn(),
    removeProfile: vi.fn(),
  } satisfies NamesControl;
  const source: SpeechSource = { start() {}, stop() {}, subscribe: () => () => {}, names: control };
  const set = (patch: Partial<NamesState>) =>
    act(() => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    });
  return { source, control, set };
}

const inSource = (source: SpeechSource, ui: React.ReactNode) => <SpeechSourceContext.Provider value={source}>{ui}</SpeechSourceContext.Provider>;

afterEach(() => {
  cleanup();
  actions.requestNames(false);
  vi.useRealTimers();
});

describe("NamesStatus", () => {
  it("shows nothing before the server has said what it can do, and says so when it cannot name voices", () => {
    const early = fakeSource({ known: false });
    const { container, rerender } = render(inSource(early.source, <NamesStatus />));
    expect(container).toBeEmptyDOMElement();
    const none = fakeSource({ available: false });
    rerender(inSource(none.source, <NamesStatus />));
    expect(screen.getByText(/Nimed ei ole selles serveris saadaval/)).toBeInTheDocument();
  });

  it("starts with names off, which is a full way to use the app", () => {
    const { control } = fakeSource();
    render(inSource({ start() {}, stop() {}, subscribe: () => () => {}, names: control }, <NamesStatus />));
    expect(screen.getByText("Nimed on väljas")).toBeInTheDocument();
    expect(screen.getByText(/täisväärtuslik/)).toBeInTheDocument();
    expect(screen.queryByText("Enne nimede sisselülitamist")).not.toBeInTheDocument();
  });

  it("needs the room's agreement before names go on, and says what a voice print is", () => {
    const { source, control } = fakeSource();
    render(inSource(source, <NamesStatus />));
    fireEvent.click(screen.getByRole("button", { name: "Lülita nimed sisse" }));
    expect(screen.getByText(/biomeetriline andmestik/)).toBeInTheDocument();
    expect(screen.getByText(/ka neid, kes häälenäidet ei andnud/)).toBeInTheDocument();
    const turnOn = screen.getAllByRole("button", { name: "Lülita nimed sisse" }).at(-1)!;
    expect(turnOn).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(turnOn);
    expect(control.setNames).toHaveBeenCalledWith(true);
  });

  it("goes straight to the consent step after Alusta nimedega, and can be declined", () => {
    actions.requestNames();
    const { source, control } = fakeSource();
    render(inSource(source, <NamesStatus />));
    expect(screen.getByText("Enne nimede sisselülitamist")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jäta nimeta" }));
    expect(screen.queryByText("Enne nimede sisselülitamist")).not.toBeInTheDocument();
    expect(control.setNames).not.toHaveBeenCalled();
  });

  it("says what the server holds while names are on, and Nimed välja turns them off at once", () => {
    const { source, control } = fakeSource({ on: true, ids: ["p1", "p2"] });
    render(inSource(source, <NamesStatus />));
    expect(screen.getByRole("status")).toHaveTextContent("Nimed on sees: 2 häälejälge, need kustuvad seansi lõpus.");
    fireEvent.click(screen.getByRole("button", { name: "Nimed välja" }));
    expect(control.setNames).toHaveBeenCalledWith(false);
  });

  it("uses the singular for one voice print", () => {
    const { source } = fakeSource({ on: true, ids: ["p1"] });
    render(inSource(source, <NamesStatus />));
    expect(screen.getByRole("status")).toHaveTextContent("1 häälejälg,");
  });
});

describe("VoiceSample", () => {
  it("is not there while names are off, and not for the unknown voice", () => {
    const off = fakeSource();
    const { container, rerender } = render(inSource(off.source, <VoiceSample s={mari} />));
    expect(container).toBeEmptyDOMElement();
    const on = fakeSource({ on: true });
    rerender(inSource(on.source, <VoiceSample s={{ ...mari, id: "Tundmatu" }} />));
    expect(container).toBeEmptyDOMElement();
  });

  it("needs the person's own agreement before a sample can be given", () => {
    const { source, control } = fakeSource({ on: true });
    render(inSource(source, <VoiceSample s={mari} />));
    const give = screen.getByRole("button", { name: "Anna häälenäide" });
    expect(give).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Nõustun, et minu häälenäitest tehakse selle seansi ajaks häälejälg/ }));
    expect(give).toBeEnabled();
    fireEvent.click(give);
    expect(control.enrollStart).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("status")).toHaveTextContent("Räägi tavalise häälega");
  });

  it("allows Valmis only after enough seconds and ends by itself after twelve", async () => {
    vi.useFakeTimers();
    const { source, control } = fakeSource({ on: true });
    render(inSource(source, <VoiceSample s={mari} />));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Anna häälenäide" }));
    expect(screen.getByRole("button", { name: "Valmis" })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByRole("button", { name: "Valmis" })).toBeEnabled();
    expect(control.enrollFinish).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(control.enrollFinish).toHaveBeenCalledWith("p1");
  });

  it("says why a sample failed and lets the person try again", async () => {
    vi.useFakeTimers();
    const { source, control } = fakeSource({ on: true });
    control.enrollFinish.mockResolvedValueOnce({ ok: false, reason: "too_little" });
    render(inSource(source, <VoiceSample s={mari} />));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Anna häälenäide" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Valmis" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Kõnet oli liiga vähe");
    expect(screen.getByRole("button", { name: "Anna häälenäide" })).toBeInTheDocument();
  });

  it("throws a sample away on Katkesta", () => {
    const { source, control } = fakeSource({ on: true });
    render(inSource(source, <VoiceSample s={mari} />));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Anna häälenäide" }));
    fireEvent.click(screen.getByRole("button", { name: "Katkesta" }));
    expect(control.enrollCancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Anna häälenäide" })).toBeInTheDocument();
  });

  it("lets the person remove their own voice print", () => {
    const { source, control } = fakeSource({ on: true, ids: ["p1"] });
    render(inSource(source, <VoiceSample s={mari} />));
    expect(screen.getByRole("status")).toHaveTextContent("Häälejälg on olemas.");
    fireEvent.click(screen.getByRole("button", { name: "Eemalda profiil" }));
    expect(control.removeProfile).toHaveBeenCalledWith("p1");
  });

  it("does not let a second person record while one sample is being taken", () => {
    const { source } = fakeSource({ on: true, enrolling: "p2" });
    render(inSource(source, <VoiceSample s={mari} />));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Anna häälenäide" })).toBeDisabled();
  });
});
