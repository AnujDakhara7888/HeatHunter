import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CloudSun, FileUp, FlaskConical, Home, PencilRuler, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, traced } from "../api/client";
import type { FloorPlanDraft, HomeAnalysis, HomePlan, RealHouse, Series } from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { EngineTrace } from "../components/EngineTrace";
import { LineChart } from "../components/LineChart";
import { Nav } from "../components/Nav";
import { PlanEditor } from "../components/PlanEditor";
import { Screening } from "../components/Screening";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { strengthOf } from "../lib/diagnosis";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { ms, roomColor } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";

type Step = "plan" | "data" | "results";
type RoomData = { series: Series; source: string };

const EMPTY: HomePlan = {
  plan_id: "my-home",
  name: "My home",
  ceiling_height_m: 2.4,
  rooms: [
    { room_id: "living_room", name: "Living room", x: 0, z: 0, width: 4.5, depth: 4, has_sensor: true, exposed_floor: true, exposed_roof: true },
    { room_id: "kitchen", name: "Kitchen", x: 4.5, z: 0, width: 3, depth: 4, has_sensor: true, exposed_floor: true, exposed_roof: true },
    { room_id: "bedroom", name: "Bedroom", x: 0, z: 4, width: 4.5, depth: 3.5, has_sensor: true, exposed_floor: true, exposed_roof: true },
    { room_id: "bathroom", name: "Bathroom", x: 4.5, z: 4, width: 3, depth: 3.5, has_sensor: true, exposed_floor: true, exposed_roof: true },
  ],
  openings: [
    { kind: "window", x0: 1, z0: 0, x1: 3, z1: 0 },
    { kind: "window", x0: 5.2, z0: 0, x1: 6.6, z1: 0 },
    { kind: "window", x0: 1, z0: 7.5, x1: 3, z1: 7.5 },
    { kind: "door", x0: 7.5, z0: 1.5, x1: 7.5, z1: 2.4 },
  ],
};

const iso = (t: number) => new Date(t).toISOString();
function defaultNight(): [number, number] {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(22, 0, 0, 0);
  return [d.getTime(), d.getTime() + 8 * 3.6e6];
}

/** Parse "timestamp, temperature" rows (CSV/TSV/semicolon); bare HH:MM times are placed in the night window. */
function parseCsv(text: string, night: [number, number]): Series {
  const ts: string[] = [];
  const vs: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) continue;
    const value = Number(cells[cells.length - 1].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    let t = Date.parse(cells[0]);
    const hm = cells[0].match(/^(\d{1,2}):(\d{2})/);
    if (Number.isNaN(t) && hm) {
      const base = new Date(night[0]);
      base.setUTCHours(Number(hm[1]), Number(hm[2]), 0, 0);
      t = base.getTime() < night[0] - 3.6e6 ? base.getTime() + 24 * 3.6e6 : base.getTime();
    }
    if (Number.isNaN(t)) continue;
    ts.push(iso(t));
    vs.push(value);
  }
  if (ts.length < 3) throw new Error("Need at least 3 rows of time, temperature");
  const order = ts.map((_, i) => i).sort((a, b) => ms(ts[a]) - ms(ts[b]));
  return { timestamps: order.map((i) => ts[i]), values: order.map((i) => vs[i]), unit: "degC", provenance: "REAL_MEASUREMENT" };
}

function manualSeries(values: (number | null)[], night: [number, number], unit = "degC"): Series | null {
  const pts = values.map((v, i) => [night[0] + (i * (night[1] - night[0])) / (values.length - 1), v] as const).filter(([, v]) => v != null);
  if (pts.length < 2) return null;
  return { timestamps: pts.map(([t]) => iso(t)), values: pts.map(([, v]) => v as number), unit, provenance: "REAL_MEASUREMENT" };
}

export default function MyHome() {
  const set = useScene((s) => s.set);
  const [step, setStep] = useState<Step>("plan");
  const [plan, setPlan] = useState<HomePlan>(EMPTY);
  const [bg, setBg] = useState<{ url: string; widthM: number; opacity: number } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [night, setNight] = useState<[number, number]>(defaultNight);
  const [data, setData] = useState<Record<string, RoomData>>({});
  const [manual, setManual] = useState<Record<string, (number | null)[]>>({});
  const [outdoor, setOutdoor] = useState<{ temp: Series; wind: Series | null; source: string } | null>(null);
  const [place, setPlace] = useState("");
  const [result, setResult] = useState<HomeAnalysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const names = useMemo(() => Object.fromEntries(plan.rooms.map((r) => [r.room_id, r.name])), [plan]);
  const sensed = plan.rooms.filter((r) => r.has_sensor !== false);

  useEffect(() => {
    set({ view: "open", finding: null, focusRoom: null, fanOn: false, labels: true, autoRotate: false, inset: 0, temps: {}, rates: {}, ir: false });
    useTrace.getState().clear();
  }, [set]);
  useEffect(() => set({ plan, names, zBearing: plan.plan_id === "smeter-hh09" ? HH09_Z_BEARING : null, windFrom: null }), [plan, names, set]);
  useEffect(() => set({ inset: step === "results" ? 460 : 0 }), [step, set]);

  const night_ = result?.nights[0];
  const roomsPlayback = useMemo(() => (night_ ? night_.room_temperature_series : null), [night_]);
  const player = useNight(roomsPlayback, night_?.weather.outdoor_temperature, night_?.weather.wind_speed, 10);

  useEffect(() => {
    const lead = result?.ranked_causes[0];
    set({
      finding:
        result?.flagged_room_id && lead && (result.status === "confident" || result.status === "ambiguous")
          ? { room: result.flagged_room_id, cause: lead.fault_type as "draft" | "envelope_conduction", strength: strengthOf(lead.fitted_multiplier) }
          : null,
    });
  }, [result, set]);

  useEffect(() => {
    useChatContext.getState().setContext(
      {
        page: "Your home: user's own plan and readings (screening, no fault labels)",
        step,
        rooms: plan.rooms.map((r) => `${r.name} ${r.width}x${r.depth} m${r.has_sensor === false ? " (no sensor)" : ""}`),
        readings: Object.fromEntries(Object.entries(data).map(([k, v]) => [names[k], v.source])),
        outdoor: outdoor?.source,
        result: result && { status: result.status, flagged_room: result.flagged_room_id && names[result.flagged_room_id], causes: result.ranked_causes, money: result.money_estimate, uncertainty: result.uncertainty },
      },
      step === "plan" ? ["How do I draw my rooms?", "What sensors should I buy?", "Can you read my plan?"] : ["What does this mean?", "Is it worth fixing?", "How do I take better readings?"],
    );
  }, [step, plan, data, outdoor, result, names]);

  const upload = async (f: File) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => setBg({ url, widthM: 10, opacity: 0.45 });
    img.src = url;
    setReading("Claude is reading your floor plan…");
    setError(null);
    setNotes([]);
    try {
      const form = new FormData();
      form.append("file", f);
      const draft = await traced<FloorPlanDraft>("plan", "POST /assistant/floor-plan", async () => {
        const response = await fetch("/api/assistant/floor-plan", { method: "POST", body: form });
        const body = await response.json();
        return response.ok ? { data: body, response } : { error: body, response };
      }, (d) => `${d.plan.rooms.length} rooms read`);
      setPlan({ ...draft.plan, plan_id: "my-home" });
      setNotes(draft.notes);
      const b = draft.plan.rooms.reduce((m, r) => Math.max(m, r.x + r.width), 0);
      setBg((cur) => (cur ? { ...cur, widthM: Math.max(b * 1.15, 4) } : cur));
      set({ view: "top" });
      setTimeout(() => set({ view: "open" }), 1600);
      setTimeout(() => set({ view: "exterior" }), 4200);
    } catch (e) {
      setNotes([
        e instanceof ApiError && e.status === 503
          ? "AI plan reading is off (no ANTHROPIC_API_KEY on the server). Your plan is shown underneath: drag the rooms to trace it."
          : `Couldn't read the plan automatically (${e instanceof Error ? e.message : e}). Trace the rooms over it instead.`,
      ]);
    } finally {
      setReading(null);
    }
  };

  const useHH09 = async () => {
    setPlan(HH09_PLAN);
    setBg(null);
    setNotes(["Loaded the documented HH09 plan. On the next step you can fill it with real HH09 readings."]);
  };

  const fillHH09 = async () => {
    setBusy("Loading real HH09 readings…");
    try {
      const h: RealHouse = await traced("real", "GET /real/house", () => api.GET("/api/real/house"));
      const a = ms("2021-02-18T22:00:00Z");
      const b = a + 8 * 3.6e6;
      const cut = (s: Series): Series => {
        const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
        return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
      };
      setNight([a, b]);
      setData(Object.fromEntries(Object.entries(h.room_temperature_series).map(([k, s]) => [k, { series: cut(s), source: "real HH09 sensor" }])));
      setOutdoor({ temp: cut(h.outdoor_temperature), wind: cut(h.wind_speed), source: "SMETER weather station, 5.2 km" });
    } finally {
      setBusy(null);
    }
  };

  const lookup = async () => {
    setBusy("Fetching weather…");
    setError(null);
    try {
      const w = await traced("weather", "GET /weather/lookup", () => api.GET("/api/weather/lookup", { params: { query: { query: place, start: iso(night[0]), end: iso(night[1]) } } }), (d) => d.location.name);
      setOutdoor({ temp: w.outdoor_temperature, wind: w.wind_speed, source: `${w.location.name} · ${w.source.provider}` });
    } catch (e) {
      setError(`${e instanceof Error ? e.message : e}. Enter the outdoor temperature by hand instead.`);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    setBusy("Fitting physics to your readings…");
    setError(null);
    try {
      const rooms: Record<string, Series> = {};
      for (const r of sensed) {
        const s = data[r.room_id]?.series ?? manualSeries(manual[r.room_id] ?? [], night);
        if (!s) throw new Error(`Add readings for ${r.name}`);
        rooms[r.room_id] = s;
      }
      if (!outdoor) throw new Error("Add the outdoor temperature");
      const res = await traced("analyze", "POST /homes/analyze", () =>
        api.POST("/api/homes/analyze", { body: { plan, room_temperature_series: rooms, outdoor_temperature: outdoor.temp, wind_speed: outdoor.wind ?? undefined, location_name: place || undefined } }),
        (d) => `${d.status} · ${d.rooms.length * 3} fits`,
      );
      setResult(res);
      setStep("results");
      set({ view: "open" });
      setTimeout(() => player.play(), 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const fmtLocal = (t: number) => new Date(t).toISOString().slice(0, 16);

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <Nav transparent />
      <HouseCanvas className={`absolute inset-0 ${step === "results" ? "" : "left-[min(52vw,760px)]"}`} />

      <div className={`pointer-events-none absolute top-16 z-20 flex justify-center ${step === "results" ? "inset-x-0 pr-[460px]" : "left-[min(52vw,760px)] right-0"}`}>
        <ViewSwitcher views={["top", "open", "exterior", "thermal", "inside"]} className="pointer-events-auto" />
      </div>

      <AnimatePresence mode="wait">
        {step !== "results" ? (
          <motion.section
            key={step}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            className="absolute bottom-4 left-4 top-16 z-30 flex w-[calc(min(52vw,760px)-24px)] flex-col rounded-[26px] glass p-5"
          >
            <div className="flex items-center gap-2 text-[11.5px]">
              {(["plan", "data", "results"] as Step[]).map((s, i) => (
                <span key={s} className={`rounded-full px-2.5 py-1 ${step === s ? "bg-ink font-semibold text-black" : "text-dim"}`}>
                  {i + 1} {s === "plan" ? "Your plan" : s === "data" ? "Readings" : "Results"}
                </span>
              ))}
            </div>

            {step === "plan" && (
              <>
                <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">
                  Build your home. <span className="text-mute">It appears in 3D as you go.</span>
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn btn-primary !py-2" onClick={() => file.current?.click()}>
                    <Upload size={15} /> Upload floor plan
                  </button>
                  <button className="btn btn-ghost !py-2" onClick={() => (setPlan(EMPTY), setBg(null), setNotes([]))}>
                    <PencilRuler size={15} /> Draw it
                  </button>
                  <button className="btn btn-ghost !py-2" onClick={useHH09}>
                    <Home size={15} /> Use HH09 example
                  </button>
                  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </div>
                {reading && (
                  <div className="mt-3 flex items-center gap-2 text-[13px] text-mute">
                    <Sparkles size={15} className="pulse-dot text-warm" /> {reading}
                  </div>
                )}
                {notes.map((n) => (
                  <div key={n} className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] text-mute">
                    {n}
                  </div>
                ))}
                {bg && (
                  <label className="mt-2 flex items-center gap-3 text-[11.5px] text-mute">
                    Plan image width
                    <input type="range" min={3} max={30} step={0.1} value={bg.widthM} onChange={(e) => setBg({ ...bg, widthM: Number(e.target.value) })} className="w-40" />
                    <span className="num text-ink">{bg.widthM.toFixed(1)} m</span>
                  </label>
                )}
                <div className="mt-3 min-h-0 flex-1">
                  <PlanEditor plan={plan} onChange={(p) => setPlan(p)} background={bg} />
                </div>
                <button className="btn btn-primary mt-4" onClick={() => (setStep("data"), set({ view: "exterior" }))} disabled={!sensed.length}>
                  Next: add readings <ArrowRight size={15} />
                </button>
              </>
            )}

            {step === "data" && (
              <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                <h1 className="text-[28px] font-bold leading-tight tracking-tight">
                  One cold night. <span className="text-mute">Heating off, doors shut.</span>
                </h1>
                <p className="mt-1 text-[12.5px] text-mute">Any cheap thermometer that logs works: export a CSV, or type a few readings.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-mute">
                  From
                  <input type="datetime-local" value={fmtLocal(night[0])} onChange={(e) => setNight([Date.parse(e.target.value + "Z"), night[1]])} className="rounded-lg border border-line bg-transparent px-2 py-1 text-ink" />
                  to
                  <input type="datetime-local" value={fmtLocal(night[1])} onChange={(e) => setNight([night[0], Date.parse(e.target.value + "Z")])} className="rounded-lg border border-line bg-transparent px-2 py-1 text-ink" />
                  <span className="text-dim">UTC</span>
                  {plan.plan_id === "smeter-hh09" && (
                    <button className="btn btn-ghost !px-3 !py-1 !text-[12px]" onClick={fillHH09}>
                      Fill with real HH09 night
                    </button>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  {sensed.map((r) => {
                    const d = data[r.room_id];
                    const m = manual[r.room_id] ?? [null, null, null, null, null];
                    return (
                      <div key={r.room_id} className="rounded-2xl border border-line bg-white/[0.02] p-3">
                        <div className="flex items-center gap-2">
                          <i className="h-2.5 w-2.5 rounded-full" style={{ background: roomColor(r.room_id, plan.rooms.map((x) => x.room_id)) }} />
                          <span className="font-semibold">{r.name}</span>
                          <span className="ml-auto text-[11px] text-dim">{d ? `${d.series.values.length} readings · ${d.source}` : "no data yet"}</span>
                          <label className="btn btn-ghost cursor-pointer !px-2.5 !py-1 !text-[11.5px]">
                            <FileUp size={13} /> CSV
                            <input
                              type="file"
                              accept=".csv,.txt,.tsv"
                              hidden
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                try {
                                  const s = parseCsv(await f.text(), night);
                                  setData((cur) => ({ ...cur, [r.room_id]: { series: s, source: f.name } }));
                                } catch (err) {
                                  setError(`${r.name}: ${err instanceof Error ? err.message : err}`);
                                }
                              }}
                            />
                          </label>
                        </div>
                        {!d && (
                          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-dim">
                            or type °C at
                            {m.map((v, i) => (
                              <input
                                key={i}
                                type="number"
                                step={0.1}
                                placeholder={new Date(night[0] + (i * (night[1] - night[0])) / 4).toISOString().slice(11, 16)}
                                value={v ?? ""}
                                onChange={(e) => setManual((cur) => ({ ...cur, [r.room_id]: m.map((x, j) => (j === i ? (e.target.value === "" ? null : Number(e.target.value)) : x)) }))}
                                className="w-16 rounded-lg border border-line bg-transparent px-2 py-1 text-[12px] text-ink placeholder:text-dim"
                              />
                            ))}
                          </div>
                        )}
                        {d && (
                          <div className="mt-2">
                            <LineChart height={70} compact legend={false} data={[{ id: r.room_id, label: r.name, color: roomColor(r.room_id, plan.rooms.map((x) => x.room_id)), series: d.series }]} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <CloudSun size={15} /> Outside
                    <span className="ml-auto text-[11px] font-normal text-dim">{outdoor?.source ?? "needed"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                    <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Town or postcode" className="w-44 rounded-lg border border-line bg-transparent px-2 py-1.5 outline-none" />
                    <button className="btn btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={lookup} disabled={place.length < 2}>
                      Fetch weather
                    </button>
                    <span className="text-dim">or</span>
                    <ManualOutdoor night={night} onSet={(temp, wind) => setOutdoor({ temp, wind, source: "entered by hand" })} />
                  </div>
                </div>
              </div>
            )}

            {step === "data" && (
              <div className="mt-3 flex gap-2">
                <button className="btn btn-ghost" onClick={() => setStep("plan")}>
                  <ArrowLeft size={15} /> Plan
                </button>
                <button className="btn btn-hot flex-1" onClick={analyze} disabled={!!busy}>
                  <FlaskConical size={15} /> Analyze my home
                </button>
              </div>
            )}
            {busy && <div className="mt-2 text-[12.5px] text-mute pulse-dot">{busy}</div>}
            {error && <div className="mt-2 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-[12px] text-hot">{error}</div>}
          </motion.section>
        ) : (
          result && (
            <motion.aside key="results" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 w-[min(440px,calc(100vw-32px))] overflow-y-auto rounded-[26px] p-5">
              <button className="mb-3 inline-flex items-center gap-1 text-[12px] text-mute hover:text-ink" onClick={() => setStep("data")}>
                <ArrowLeft size={13} /> edit readings
              </button>
              <Screening result={result} names={names} />
            </motion.aside>
          )
        )}
      </AnimatePresence>

      {step === "results" && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-[476px] z-20 flex flex-col gap-2">
          <EngineTrace className="pointer-events-auto max-w-[520px]" />
          <Timeline className="pointer-events-auto max-w-[640px]" {...player} onPlay={player.play} onPause={player.pause} onScrub={player.setT} caption="Your readings, replayed through your house" />
        </div>
      )}
    </div>
  );
}

function ManualOutdoor({ night, onSet }: { night: [number, number]; onSet: (t: Series, w: Series | null) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [w, setW] = useState("");
  const apply = (na = a, nb = b, nw = w) => {
    if (na === "" || nb === "") return;
    const t = manualSeries([Number(na), Number(nb)], night);
    const wind = nw === "" ? null : manualSeries([Number(nw), Number(nw)], night, "m/s");
    if (t) onSet(t, wind);
  };
  return (
    <span className="flex items-center gap-1.5 text-dim">
      <input type="number" step={0.1} placeholder="start °C" value={a} onChange={(e) => (setA(e.target.value), apply(e.target.value, b, w))} className="w-20 rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink" />
      <input type="number" step={0.1} placeholder="end °C" value={b} onChange={(e) => (setB(e.target.value), apply(a, e.target.value, w))} className="w-20 rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink" />
      <input type="number" step={0.1} placeholder="wind m/s" value={w} onChange={(e) => (setW(e.target.value), apply(a, b, e.target.value))} className="w-20 rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink" />
    </span>
  );
}
