import { useEffect, useState, type RefObject } from "react";

/** Wall clock that re-renders its caller every `intervalMs`, so fading follows time. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Content-box size of an element in px; 0×0 until it has been measured. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((p) => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The page's root font size in px; re-read on resize because browser zoom changes it. */
export function useRemPx() {
  const [rem, setRem] = useState(16);
  useEffect(() => {
    const read = () => setRem(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return rem;
}
