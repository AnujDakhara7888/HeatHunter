import { ArrowLeft, BadgeCheck, Loader2, Pause, Play, Thermometer } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, type RealHouse } from "../lib/api";
import { fmt } from "../lib/format";
import { REAL_ROOMS, type TwinRoomId } from "../lib/rooms";
import { THERMAL_CSS, type CameraView } from "./houseTypes";
import { setChatContext } from "./chatContext";
import { WeatherCard } from "./WeatherCard";

const RealisticHouse = lazy(() => import("./RealisticHouse"));

const SPEEDS = [1, 2, 4];

function at(values: (number | null)[], i: number): number | null {
  for (let k = Math.min(i, values.length - 1); k >= 0; k--) if (values[k] != null) return values[k];
  return null;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function RealWeek({ onBack, onCheck }: { onBack: () => void; onCheck: () => void }) {
  const [house, setHouse] = useState<RealHouse | null>(null);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [heatView, setHeatView] = useState(true);
  const [view, setView] = useState<CameraView>("inside");
  const [nonce, setNonce] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .realHouse()
      .then(setHouse)
      .catch(() => setError(true));
  }, []);

  const ts = house?.outdoor_temperature.timestamps ?? [];
  const length = ts.length;

  useEffect(() => {
    if (!playing || !length) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => {
        const next = i + speed;
        if (next >= length - 1) {
          setPlaying(false);
          return length - 1;
        }
        return next;
      });
    }, 90);
    return () => window.clearInterval(timer.current);
  }, [playing, speed, length]);

  const { readings, thermal, rooms } = useMemo(() => {
    const readings: Partial<Record<TwinRoomId, { temp: number | null }>> = {};
    const rooms: { id: string; name: string; color: string; temp: number | null; inModel: boolean }[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    if (house) {
      for (const [id, series] of Object.entries(house.room_temperature_series)) {
        for (const v of series.values) if (v != null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
        const meta = REAL_ROOMS[id];
        const temp = at(series.values, index);
        if (meta?.twinSlot) readings[meta.twinSlot] = { temp };
        rooms.push({ id, name: meta?.name ?? id, color: meta?.color ?? "#aaa", temp, inModel: !!meta?.twinSlot });
      }
    }
    const order = Object.keys(REAL_ROOMS);
    rooms.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { readings, thermal: (Number.isFinite(lo) ? [Math.floor(lo), Math.ceil(hi)] : [12, 22]) as [number, number], rooms };
  }, [house, index]);

  const iso = ts[index];
  const hour = iso ? new Date(iso).getUTCHours() + new Date(iso).getUTCMinutes() / 60 : 12;
  const phase = hour >= 7.5 && hour < 17.25 ? "day" : "night";
  const wind = house ? at(house.wind_speed.values, index) : null;
  const outdoor = house ? at(house.outdoor_temperature.values, index) : null;
  useEffect(() => {
    if (!iso) return;
    const temps = rooms.map((r) => `${r.name} ${r.temp != null ? r.temp.toFixed(1) + "°C" : "no reading"}`).join(", ");
    setChatContext(
      `The visitor is on the "Real data" page, replaying real sensor readings from the real house (18–24 February 2021). No problem is claimed for this real home. Shown time: ${stamp(iso)}. Rooms: ${temps}. Outside: ${outdoor != null ? outdoor.toFixed(1) + "°C" : "unknown"}, wind ${wind != null ? wind.toFixed(1) + " m/s" : "unknown"}.`,
    );
  }, [iso, rooms, outdoor, wind]);

  const days = useMemo(() => {
    const out: { i: number; label: string }[] = [];
    ts.forEach((t, i) => {
      const d = new Date(t);
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) out.push({ i, label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) });
    });
    return out;
  }, [ts]);

  if (error)
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center text-white/70">
        The real data couldn't be loaded. <button className="underline" onClick={onBack}>Go back</button>
      </div>
    );

  const move = (v: CameraView) => {
    setView(v);
    setNonce((n) => n + 1);
  };

  return (
    <div className="grid min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="relative min-h-[60vh] lg:h-[calc(100vh-64px)]">
        {house ? (
          <Suspense fallback={<div className="grid h-full place-items-center text-white/60"><Loader2 className="animate-spin" /></div>}>
            <RealisticHouse
              phase={phase}
              roofOpen={view === "inside"}
              heatView={heatView && view === "inside"}
              readings={readings}
              thermal={thermal}
              showLabels={view === "inside"}
              problemRoom={null}
              problem={null}
              fixedRoom={null}
              truthRoom={null}
              fanOn={false}
              selected={null}
              onSelect={() => undefined}
              autoRotate={false}
              view={view}
              viewNonce={nonce}
              windSpeed={wind}
              height="100%"
            />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center text-white/60">
            <Loader2 className="animate-spin" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/40 bg-black/50 px-4 py-2 text-[13.5px] text-white backdrop-blur-md">
            <BadgeCheck size={16} className="text-emerald-400" /> Real measurements
            {iso && <span className="font-semibold">· {stamp(iso)}</span>}
          </div>
          <button className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3.5 py-2 text-[13px] text-white/80 backdrop-blur-md hover:text-white" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </button>
        </div>

        {house && (
          <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/12 bg-black/55 px-3 py-2.5 backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
                onClick={() => {
                  if (index >= length - 1) setIndex(0);
                  setPlaying((p) => !p);
                }}
                aria-label={playing ? "Pause" : "Play the week"}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <div className="relative min-w-0 flex-1 basis-40">
                <input type="range" className="w-full accent-emerald-400" min={0} max={Math.max(0, length - 1)} value={index} onChange={(e) => (setPlaying(false), setIndex(Number(e.target.value)))} aria-label="Time in the week" />
                <div className="pointer-events-none relative mt-0.5 h-3.5 text-[10.5px] text-white/50">
                  {days.map((d) => (
                    <span key={d.i} className="absolute -translate-x-1/2" style={{ left: `${(d.i / Math.max(1, length - 1)) * 100}%` }}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-1 rounded-full bg-white/10 p-1">
                {SPEEDS.map((s) => (
                  <button key={s} className={`rounded-full px-2.5 py-1 text-[12px] ${speed === s ? "bg-white text-black" : "text-white/75"}`} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <div className="flex gap-1 rounded-full bg-white/10 p-1">
                <button className={`rounded-full px-3 py-1 text-[12.5px] ${view === "outside" ? "bg-white text-black" : "text-white/75"}`} onClick={() => move("outside")}>
                  Outside
                </button>
                <button className={`rounded-full px-3 py-1 text-[12.5px] ${view === "inside" ? "bg-white text-black" : "text-white/75"}`} onClick={() => move("inside")}>
                  Inside
                </button>
              </div>
              {view === "inside" && (
                <button className={`rounded-full px-3 py-1.5 text-[12.5px] ${heatView ? "bg-emerald-500 text-white" : "bg-white/10 text-white/75"}`} onClick={() => setHeatView((h) => !h)} aria-pressed={heatView}>
                  <Thermometer size={13} className="mr-1 inline" />
                  Heat view
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <aside className="border-l border-white/8 bg-[#10151c] lg:h-[calc(100vh-64px)] lg:overflow-y-auto">
        <div className="space-y-6 p-6 sm:p-7">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1 text-[12.5px] font-semibold text-emerald-300">
              <BadgeCheck size={14} /> Real data
            </span>
            <h1 className="mt-3 text-[24px] font-semibold leading-tight tracking-tight text-white">A real week in this home</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-white/65">
              These are the actual temperatures recorded by sensors in each room of the real bungalow
              {house ? `, ${new Date(house.measurement_start).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })} to ${new Date(house.measurement_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : ""}
              . Watch the rooms warm up and cool down, day after day.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between text-[13px] text-white/55">
              <span>Room temperatures now</span>
              <span className="flex items-center gap-1.5">
                {thermal[0]}° <span className="h-2 w-16 rounded-full" style={{ background: THERMAL_CSS }} /> {thermal[1]}°
              </span>
            </div>
            <div className="divide-y divide-white/8">
              {rooms.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 text-[14.5px]">
                  <span className="flex items-center gap-2 text-white/85">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                    {r.name}
                    {!r.inModel && <span className="text-[11.5px] text-white/40">(not in 3D)</span>}
                  </span>
                  <span className="font-semibold tabular-nums text-white">{r.temp != null ? `${fmt(r.temp, 1)}°C` : "—"}</span>
                </div>
              ))}
            </div>
          </div>

          {house && (
            <WeatherCard
              className="!bg-white/[0.03] !border-white/10"
              temps={house.outdoor_temperature.values}
              winds={house.wind_speed.values}
              index={index}
              period="this week"
            />
          )}

          <p className="text-[13.5px] leading-relaxed text-white/55">
            This is the kind of data HeatHunter reads: a temperature sensor in each room and the local weather. No problem is claimed for this real
            home — the hidden problems in our checks are planted in a virtual copy of it.
          </p>
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-400 to-orange-600 text-[15px] font-semibold text-white shadow-lg shadow-orange-900/30 hover:from-orange-300"
            onClick={onCheck}
          >
            Run a check on the virtual copy
          </button>
          <p className="text-[12px] leading-relaxed text-white/35">
            Data: SMETER Phase 2 study, UK Data Service. Weather from the study's local weather station. Timestamps shown as UK time (GMT).
          </p>
        </div>
      </aside>
    </div>
  );
}
