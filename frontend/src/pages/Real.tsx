import { motion } from "framer-motion";
import { Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, traced } from "../api/client";
import type { RealHouse, Series } from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { EngineTrace } from "../components/EngineTrace";
import { LineChart } from "../components/LineChart";
import { Nav } from "../components/Nav";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { ROOM_NAMES, fmtDate, ms, roomColor } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";

const NAMES = Object.fromEntries(HH09_PLAN.rooms.map((r) => [r.room_id, r.name]));

function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

export default function Real() {
  const set = useScene((s) => s.set);
  const [house, setHouse] = useState<RealHouse | null>(null);
  const [plan, setPlanImg] = useState(false);
  const [nightIdx, setNightIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    set({ plan: HH09_PLAN, view: "open", finding: null, focusRoom: null, fanOn: false, labels: true, autoRotate: false, inset: 460, names: NAMES, ir: false, zBearing: HH09_Z_BEARING, windFrom: null });
    useTrace.getState().clear();
    traced("real", "GET /real/house", () => api.GET("/api/real/house"), (h) => `${Object.keys(h.room_temperature_series).length} sensors · ${h.outdoor_temperature.values.length} readings`)
      .then(setHouse)
      .catch((e) => setError(String(e)));
  }, [set]);

  const nights = useMemo(() => {
    if (!house) return [];
    const start = ms(house.measurement_start);
    const end = ms(house.measurement_end);
    const out: [number, number][] = [];
    for (let t = start + 22 * 3.6e6; t + 8 * 3.6e6 <= end; t += 24 * 3.6e6) out.push([t, t + 8 * 3.6e6]);
    return out;
  }, [house]);

  const window_ = nightIdx != null ? nights[nightIdx] : null;
  const rooms = useMemo(() => {
    if (!house) return null;
    if (!window_) return house.room_temperature_series;
    return Object.fromEntries(Object.entries(house.room_temperature_series).map(([k, s]) => [k, slice(s, ...window_)]));
  }, [house, window_]);
  const outdoor = useMemo(() => (house ? (window_ ? slice(house.outdoor_temperature, ...window_) : house.outdoor_temperature) : null), [house, window_]);
  const wind = useMemo(() => (house ? (window_ ? slice(house.wind_speed, ...window_) : house.wind_speed) : null), [house, window_]);
  const player = useNight(rooms, outdoor, wind, window_ ? 10 : 24);


  useEffect(() => {
    useChatContext.getState().setContext(
      {
        page: "Real home: measured SMETER HH09 data",
        disclaimer: house?.scientific_disclaimer,
        characteristics: house?.characteristics.map((c) => `${c.name}: ${c.value}${c.unit ? " " + c.unit : ""}`),
        measured_heat_transfer_coefficient: house?.reference_htc,
        airtightness: house?.airtightness,
        night_on_screen: window_ ? fmtDate(window_[0]) : "whole week",
        visible_window: window_ ? { start: new Date(window_[0]).toISOString(), end: new Date(window_[1]).toISOString() } : undefined,
        monitoring: "Not monitored: the heating was on during this week, so heating-off nights do not exist.",
      },
      ["Is this real data?", "Which room cools fastest?", "Why no fault labels?"],
    );
  }, [house, window_]);


  const chartData = rooms
    ? [
        ...Object.entries(rooms).map(([k, s]) => ({ id: k, label: ROOM_NAMES[k] ?? k, color: roomColor(k), series: s })),
        ...(outdoor ? [{ id: "out", label: "Outside", color: "#8a90a2", series: outdoor, dashed: true, width: 1.5 }] : []),
      ]
    : [];
  const stat = (name: string) => house?.characteristics.find((c) => c.name === name);

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <Nav transparent />
      <HouseCanvas className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center pr-[460px]">
        <ViewSwitcher views={["exterior", "thermal", "open", "inside", "top"]} className="pointer-events-auto" />
      </div>

      <motion.aside initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 w-[min(440px,calc(100vw-32px))] overflow-y-auto rounded-[26px] p-5">
        <div className="eyebrow">Real measurements · no simulation</div>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">
          HH09, a real bungalow. <span className="text-mute">One week of winter.</span>
        </h1>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          {[
            ["Floor area", stat("total_floor_area") ? `${stat("total_floor_area")!.value} m²` : "–"],
            ["Heat loss (HTC)", house?.reference_htc ? `${house.reference_htc.value} W/K` : "–"],
            ["Airtightness", house?.airtightness ? `${house.airtightness.value} ACH50` : "–"],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white/[0.04] px-3 py-2">
              <div className="text-mute">{l}</div>
              <div className="num text-[15px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-mute">
          {house?.characteristics
            .filter((c) => typeof c.value === "string")
            .slice(0, 5)
            .map((c) => (
              <span key={c.name} className="rounded-full border border-line px-2 py-0.5">
                {String(c.value)}
              </span>
            ))}
          <button onClick={() => setPlanImg((p) => !p)} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 hover:text-ink">
            <ImageIcon size={11} /> {plan ? "hide" : "original"} floor plan
          </button>
        </div>
        {plan && <img src="/api/real/house/floor-plan" alt="Published HH09 floor plan" className="mt-3 rounded-xl bg-white p-2" />}

        {rooms && (
          <div className="mt-4">
            <LineChart data={chartData} height={190} cursor={player.t} onScrub={player.setT} />
          </div>
        )}

        <div className="mt-4">
          <div className="text-[12px] font-semibold">Replay one night</div>
          <div className="mt-1 text-[11px] text-dim">22:00 to 06:00, real sensor readings.</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {nights.map(([a], i) => (
              <button key={a} onClick={() => (setNightIdx(i), setTimeout(() => player.play(), 200))} className={`btn !px-3 !py-1 !text-[12px] ${nightIdx === i ? "btn-primary" : "btn-ghost"}`}>
                {new Date(a).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}
              </button>
            ))}
            {nightIdx != null && (
              <button onClick={() => setNightIdx(null)} className="btn btn-ghost !px-3 !py-1 !text-[12px]">
                whole week
              </button>
            )}
          </div>
        </div>
        {error && <div className="mt-3 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-[12px] text-hot">{error}</div>}
        <div className="mt-4 rounded-2xl border border-line bg-white/[0.02] p-3 text-[12px] leading-snug text-mute">
          <b className="text-ink">Why this week isn't monitored:</b> the heating ran overnight, so there are no heating-off nights for the
          engine to judge. It shows what real sensors record. The Fault Lab watches the same house's digital twin with the heating off.
        </div>
        <p className="mt-5 text-[10.5px] leading-relaxed text-dim">{house?.scientific_disclaimer}</p>
      </motion.aside>

      <div className="pointer-events-none absolute bottom-4 left-4 right-[476px] z-20 flex flex-col gap-2">
        <EngineTrace className="pointer-events-auto max-w-[520px]" />
        <Timeline className="pointer-events-auto max-w-[640px]" {...player} onPlay={player.play} onPause={player.pause} onScrub={player.setT} caption={window_ ? "Real night · occupied home, heating schedule unknown" : "Real measurements · 30-minute sensor readings"} />
      </div>
    </div>
  );
}
