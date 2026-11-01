import { createContext, useContext, useSyncExternalStore } from "react";
import type { NamesControl, NamesState, SpeechSource } from "./types";

/** The speech source the app uses; the page that lists participants reaches the names controls through it. */
export const SpeechSourceContext = createContext<SpeechSource | null>(null);

const NONE: NamesState = { known: false, available: false, on: false, ids: [], enrolling: null };
const noSubscription = () => () => {};

/** The names controls of the current source (null for the demo and replays) and what they currently say. */
export function useNames(): { control: NamesControl | null; state: NamesState } {
  const control = useContext(SpeechSourceContext)?.names ?? null;
  const state = useSyncExternalStore(
    control ? control.subscribe : noSubscription,
    control ? control.state : () => NONE,
    () => NONE,
  );
  return { control, state };
}
