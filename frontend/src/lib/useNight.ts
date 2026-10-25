import { useEffect, useMemo, useRef, useState } from "react";
import type { Series } from "../api/types";
import { coolingRate, timeRange, valueAt } from "./rooms";
import { useScene } from "../store/scene";

/**
 * Plays a night of measurements through the 3D heat map. Every frame the
 * scene's room temperatures are interpolated from the real series.
 */
export function useNight(rooms: Record<string, Series> | null, outdoor?: Series | null, wind?: Series | null, seconds = 14) {
  const set = useScene((s) => s.set);
  const range = useMemo<[number, number] | null>(() => {
    const any = rooms && Object.values(rooms)[0];
    return any ? timeRange(any) : null;
  }, [rooms]);
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!rooms || !range) return;
    const values = Object.values(rooms).flatMap((s) => s.values).filter((v): v is number => v != null);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(0.5, (hi - lo) * 0.08);
    set({
      tempRange: [lo - pad, hi + pad],
      rates: Object.fromEntries(Object.entries(rooms).map(([k, s]) => [k, coolingRate(s)])),
    });
    setT(range[0]);
  }, [rooms, range, set]);

  useEffect(() => {
    if (!rooms || t == null) return;
    set({
      temps: Object.fromEntries(Object.entries(rooms).map(([k, s]) => [k, valueAt(s, t)])),
      outdoor: valueAt(outdoor ?? undefined, t),
      wind: valueAt(wind ?? undefined, t),
    });
  }, [t, rooms, outdoor, wind, set]);

  useEffect(() => {
    if (!playing || !range) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      setT((cur) => {
        const next = (cur ?? range[0]) + ((range[1] - range[0]) * dt) / (seconds * 1000);
        if (next >= range[1]) {
          setPlaying(false);
          return range[1];
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, range, seconds]);

  return {
    t,
    setT: (v: number) => {
      setPlaying(false);
      setT(v);
    },
    range,
    playing,
    play: () => {
      if (range && t != null && t >= range[1] - 1) setT(range[0]);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
  };
}
