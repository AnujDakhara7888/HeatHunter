import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BarChart3, FileUp, Home, MapPin, PencilRuler, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, traced } from "../api/client";
import { Analytics } from "../components/Analytics";
import type { FixAction, FloorPlanDraft, HomeHealth, HomeHistory, HomePlan, HomeReadings, HomeSummary, RoomReport, RoomTechnical, Series } from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { EngineTrace } from "../components/EngineTrace";
import { LineChart } from "../components/LineChart";
import { Nav } from "../components/Nav";
import { PlanEditor } from "../components/PlanEditor";
import { RoomDetail } from "../components/RoomDetail";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { FLAG_STATUSES, ROOM_STATUS, strengthOf } from "../lib/diagnosis";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { fmtDate, ms, roomColor, type CauseKey } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";

type Step = "plan" | "setup" | "data" | "results";
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

const PLAN_KEY = (id: string) => `heathunter.plan.${id}`;
function savePlan(id: string, plan: HomePlan) {
  try {
    localStorage.setItem(PLAN_KEY(id), JSON.stringify(plan));
  } catch {
    /* storage unavailable: the 3D view falls back to the sample plan */
  }
}
function loadPlan(id: string): HomePlan | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY(id));
    return raw ? (JSON.parse(raw) as HomePlan) : null;
  } catch {
    return null;
  }
}

function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

/** Parse "timestamp, temperature" rows (CSV/TSV/semicolon), e.g. a logger export covering several nights. */
function parseCsv(text: string): Series {
  const ts: string[] = [];
  const vs: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) continue;
    const value = Number(cells[cells.length - 1].replace(",", "."));
    const t = Date.parse(cells[0]);
    if (!Number.isFinite(value) || Number.isNaN(t)) continue;
    ts.push(new Date(t).toISOString());
    vs.push(value);
  }
  if (ts.length < 3) throw new Error("Need rows of: date-time, temperature (°C)");
  const order = ts.map((_, i) => i).sort((a, b) => ms(ts[a]) - ms(ts[b]));
  return { timestamps: order.map((i) => ts[i]), values: order.map((i) => vs[i]), unit: "degC", provenance: "REAL_MEASUREMENT" };
}

export default function MyHome() {
  const set = useScene((s) => s.set);
  const [step, setStep] = useState<Step>("plan");
  const [plan, setPlan] = useState<HomePlan>(EMPTY);
  const [bg, setBg] = useState<{ url: string; widthM: number; opacity: number } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [homeName, setHomeName] = useState("My home");
  const [place, setPlace] = useState("");
  const [offStart, setOffStart] = useState("22:00");
  const [offEnd, setOffEnd] = useState("06:00");
  const [home, setHome] = useState<HomeSummary | null>(null);
  const [saved, setSaved] = useState<HomeSummary[]>([]);
  const [data, setData] = useState<Record<string, RoomData>>({});
  const [health, setHealth] = useState<HomeHealth | null>(null);
  const [readings, setReadings] = useState<HomeReadings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<RoomReport | null>(null);
  const [technical, setTechnical] = useState<RoomTechnical | null>(null);
  const [preview, setPreview] = useState<CauseKey | null>(null);
  const [nightIdx, setNightIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<HomeHistory | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const names = useMemo(() => Object.fromEntries(plan.rooms.map((r) => [r.room_id, r.name])), [plan]);
  const sensed = plan.rooms.filter((r) => r.has_sensor !== false);

  useEffect(() => {
    set({ view: "open", finding: null, focusRoom: null, fanOn: false, labels: true, autoRotate: false, inset: 0, temps: {}, rates: {}, ir: false });
    useTrace.getState().clear();
    traced("homes", "GET /homes", () => api.GET("/api/homes"), (d) => `${d.length} homes`)
      .then((all) => setSaved(all.filter((h) => h.kind === "real")))
      .catch(() => null);
    return () => useChatContext.getState().setHome(null);
  }, [set]);
  useEffect(() => set({ plan, names, zBearing: plan.plan_id === "smeter-hh09" ? HH09_Z_BEARING : null, windFrom: null }), [plan, names, set]);
  useEffect(() => set({ inset: step === "results" ? 460 : 0 }), [step, set]);

  const nights = readings?.nights ?? [];
  const night = nights.length ? nights[nightIdx ?? nights.length - 1] : null;
  const window_ = night ? ([ms(night.start), ms(night.end)] as [number, number]) : null;
  const roomsPlayback = useMemo(
    () => (readings && window_ ? Object.fromEntries(Object.entries(readings.rooms).map(([k, r]) => [k, slice(r.measured, ...window_)])) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readings, window_?.[0]],
  );
  const outdoor = useMemo(() => (readings && window_ ? slice(readings.outdoor_temperature, ...window_) : null), [readings, window_?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const wind = useMemo(() => (readings && window_ ? slice(readings.wind_speed, ...window_) : null), [readings, window_?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const player = useNight(roomsPlayback, outdoor, wind, 10);

  const flagged = health?.rooms.find((r) => FLAG_STATUSES.includes(r.status));
  useEffect(() => {
    const target = flagged;
    if (preview && target) {
      set({ finding: preview === "normal" ? null : { room: target.room_id, cause: preview, strength: strengthOf(target.extra_heat_loss_percent) } });
      return;
    }
    set({ finding: target ? { room: target.room_id, cause: target.status === "verifying" ? null : target.likely_cause ?? null, strength: strengthOf(target.extra_heat_loss_percent) } : null });
  }, [flagged, preview, set]);

  useEffect(() => {
    useChatContext.getState().setHome(home?.home_id ?? null);
    useChatContext.getState().setContext(
      {
        page: "Your home: the user's own plan and sensor readings, monitored night after night",
        step,
        rooms: health ? health.rooms.map((r) => `${r.name}: ${ROOM_STATUS[r.status].label} — ${r.headline}`) : plan.rooms.map((r) => r.name),
        selected_room: report && { name: report.name, headline: report.headline, why: report.why, what_to_do: report.what_to_do, money: report.money && { annual_cost_gbp: report.money.annual_cost_gbp, repair_cost_gbp: report.money.repair_cost_gbp, payback_years: report.money.payback_years } },
        nights: nights.length,
      },
      step === "plan" ? ["How do I draw my rooms?", "What sensors should I buy?", "Can you read my plan?"] : ["What does this mean?", "Is it worth fixing?", "Why several nights?"],
    );
  }, [step, plan, home, health, report, nights.length]);

  const run = async <T,>(what: string, fn: () => Promise<T>) => {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

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

  const useHH09 = () => {
    setPlan(HH09_PLAN);
    setBg(null);
    setNotes(["Loaded the documented HH09 plan."]);
  };

  const openRoom = async (homeId: string, roomId: string) => {
    setSelected(roomId);
    setPreview(null);
    set({ focusRoom: roomId });
    const [rep, tech] = await Promise.all([
      traced("room", "GET /rooms/{room}", () => api.GET("/api/homes/{home_id}/rooms/{room_id}", { params: { path: { home_id: homeId, room_id: roomId } } }), (d) => ROOM_STATUS[d.status].label),
      traced("tech", "GET /rooms/{room}/technical", () => api.GET("/api/homes/{home_id}/rooms/{room_id}/technical", { params: { path: { home_id: homeId, room_id: roomId } } })).catch(() => null),
    ]);
    setReport(rep);
    setTechnical(tech);
  };

  const showHealth = async (homeId: string, h: HomeHealth) => {
    setHealth(h);
    setHome(h.home);
    const [r, hist] = await Promise.all([
      traced("readings", "GET /homes/{id}/readings", () => api.GET("/api/homes/{home_id}/readings", { params: { path: { home_id: homeId } } }), (d) => `${d.nights.length} heating-off nights`),
      traced("history", "GET /homes/{id}/history", () => api.GET("/api/homes/{home_id}/history", { params: { path: { home_id: homeId } } }), (d) => `${d.rooms.length} rooms × ${d.nights.length} nights`).catch(() => null),
    ]);
    setReadings(r);
    setHistory(hist);
    setNightIdx(null);
    setStep("results");
    set({ view: "open" });
    const room = selected ?? h.rooms.find((x) => FLAG_STATUSES.includes(x.status))?.room_id ?? h.rooms[0]?.room_id;
    if (room) await openRoom(homeId, room);
    setTimeout(() => player.play(), 400);
  };

  const openSaved = (h: HomeSummary) =>
    run("Opening your home…", async () => {
      setPlan(loadPlan(h.home_id) ?? HH09_PLAN);
      setHome(h);
      const hh = await traced("health", "GET /homes/{id}", () => api.GET("/api/homes/{home_id}", { params: { path: { home_id: h.home_id } } }), (d) => d.home.status);
      await showHealth(h.home_id, hh);
    });

  const create = () =>
    run("Setting up your home (looking up its location)…", async () => {
      const h = await traced("create", "POST /homes", () =>
        api.POST("/api/homes", { body: { name: homeName, plan, location_query: place, heating_off: { start: offStart, end: offEnd, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London" } } }),
        (d) => d.home_id,
      );
      savePlan(h.home_id, plan);
      setHome(h);
      setStep("data");
    });

  const uploadReadings = () =>
    run("Fetching weather and checking every night…", async () => {
      const missing = sensed.filter((r) => !data[r.room_id]);
      if (missing.length) throw new Error(`Add readings for ${missing.map((r) => r.name).join(", ")}`);
      const h = await traced("upload", "POST /homes/{id}/readings", () =>
        api.POST("/api/homes/{home_id}/readings", { params: { path: { home_id: home!.home_id } }, body: { room_temperature_series: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.series])) } }),
        (d) => `${d.home.nights_monitored} nights · ${d.home.status}`,
      );
      await showHealth(home!.home_id, h);
    });

  const fix = (action: FixAction) =>
    run("Recording your repair…", async () => {
      const rep = await traced("fix", "POST /rooms/{room}/fix", () => api.POST("/api/homes/{home_id}/rooms/{room_id}/fix", { params: { path: { home_id: home!.home_id, room_id: selected! } }, body: { action } }), (d) => ROOM_STATUS[d.status].label);
      setReport(rep);
      const h = await traced("health", "GET /homes/{id}", () => api.GET("/api/homes/{home_id}", { params: { path: { home_id: home!.home_id } } }), (d) => d.home.status);
      setHealth(h);
    });

  const sel = health?.rooms.find((r) => r.room_id === selected);
  const roomReadings = selected && readings ? readings.rooms[selected] : null;
  const chartData =
    roomReadings && window_
      ? [
          { id: "m", label: `${names[selected!] ?? selected} measured`, color: "#f2f3f5", series: slice(roomReadings.measured, ...window_), width: 2 },
          ...(roomReadings.expected_if_healthy ? [{ id: "e", label: "Expected if healthy", color: "#2fd18b", series: slice(roomReadings.expected_if_healthy, ...window_), dashed: true }] : []),
          ...(outdoor ? [{ id: "o", label: "Outside", color: "#8a90a2", series: outdoor, dashed: true, width: 1.5 }] : []),
        ]
      : null;
  const order = plan.rooms.map((x) => x.room_id);

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
            className="glass absolute bottom-4 left-4 top-16 z-30 flex w-[calc(min(52vw,760px)-24px)] flex-col rounded-[26px] p-5"
          >
            <div className="flex items-center gap-2 text-[11.5px]">
              {(["plan", "setup", "data", "results"] as Step[]).map((s, i) => (
                <span key={s} className={`rounded-full px-2.5 py-1 ${step === s ? "bg-ink font-semibold text-black" : "text-dim"}`}>
                  {i + 1} {s === "plan" ? "Your plan" : s === "setup" ? "Where & when" : s === "data" ? "Readings" : "Health"}
                </span>
              ))}
            </div>

            {step === "plan" && (
              <>
                <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">
                  Build your home. <span className="text-mute">It appears in 3D as you go.</span>
                </h1>
                {saved.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
                    Your homes:
                    {saved.map((h) => (
                      <button key={h.home_id} onClick={() => openSaved(h)} className="rounded-full border border-line px-2.5 py-1 hover:text-ink">
                        {h.name} · {h.nights_monitored} nights
                      </button>
                    ))}
                  </div>
                )}
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
                <button className="btn btn-primary mt-4" onClick={() => (setStep("setup"), set({ view: "exterior" }))} disabled={!sensed.length}>
                  Next: where and when <ArrowRight size={15} />
                </button>
              </>
            )}

            {step === "setup" && (
              <div className="mt-3 space-y-4">
                <h1 className="text-[28px] font-bold leading-tight tracking-tight">
                  Where is it? <span className="text-mute">When is the heating off?</span>
                </h1>
                <p className="text-[12.5px] text-mute">HeatHunter fetches your local weather for every night and only judges the hours when the heating is reliably off.</p>
                <label className="block text-[12px] text-mute">
                  Name
                  <input value={homeName} onChange={(e) => setHomeName(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-ink outline-none focus:border-white/40" />
                </label>
                <label className="block text-[12px] text-mute">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} /> Town or postcode
                  </span>
                  <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Loughborough" className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-ink outline-none placeholder:text-dim focus:border-white/40" />
                </label>
                <div className="flex items-center gap-3 text-[12px] text-mute">
                  Heating off from
                  <input type="time" value={offStart} onChange={(e) => setOffStart(e.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink" />
                  to
                  <input type="time" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink" />
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost" onClick={() => setStep("plan")}>
                    <ArrowLeft size={15} /> Plan
                  </button>
                  <button className="btn btn-primary flex-1" onClick={create} disabled={!!busy || place.trim().length < 2}>
                    Create my home <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {step === "data" && (
              <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                <h1 className="text-[28px] font-bold leading-tight tracking-tight">
                  Your sensor logs. <span className="text-mute">Several nights is best.</span>
                </h1>
                <p className="mt-1 text-[12.5px] text-mute">
                  One CSV per room from any logging thermometer (date-time, °C). A night counts when every room has readings across the heating-off hours.
                </p>
                <div className="mt-4 space-y-2">
                  {sensed.map((r) => {
                    const d = data[r.room_id];
                    return (
                      <div key={r.room_id} className="rounded-2xl border border-line bg-white/[0.02] p-3">
                        <div className="flex items-center gap-2">
                          <i className="h-2.5 w-2.5 rounded-full" style={{ background: roomColor(r.room_id, order) }} />
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
                                  const s = parseCsv(await f.text());
                                  setData((cur) => ({ ...cur, [r.room_id]: { series: s, source: f.name } }));
                                } catch (err) {
                                  setError(`${r.name}: ${err instanceof Error ? err.message : err}`);
                                }
                              }}
                            />
                          </label>
                        </div>
                        {d && (
                          <div className="mt-2">
                            <LineChart height={70} compact legend={false} data={[{ id: r.room_id, label: r.name, color: roomColor(r.room_id, order), series: d.series }]} />
                            <div className="num mt-1 text-[10.5px] text-dim">
                              {fmtDate(ms(d.series.timestamps[0]))} → {fmtDate(ms(d.series.timestamps.at(-1)!))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {step === "data" && (
              <div className="mt-3 flex gap-2">
                <button className="btn btn-hot flex-1" onClick={uploadReadings} disabled={!!busy}>
                  Check my home
                </button>
              </div>
            )}
            {busy && <div className="mt-2 text-[12.5px] text-mute pulse-dot">{busy}</div>}
            {error && <div className="mt-2 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-[12px] text-hot">{error}</div>}
          </motion.section>
        ) : (
          health && home && (
            <motion.aside key="results" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 w-[min(440px,calc(100vw-32px))] overflow-y-auto rounded-[26px] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="eyebrow">{home.name} · real home</div>
                  <div className="mt-0.5 text-[24px] font-bold tracking-tight">{home.nights_monitored} heating-off nights</div>
                </div>
                <button className="btn btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={() => setStep("data")}>
                  Add readings
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {nights.map((n, i) => (
                  <button key={n.night_id} onClick={() => setNightIdx(i)} className={`num h-7 min-w-7 rounded-md px-1.5 text-[11px] ${i === (nightIdx ?? nights.length - 1) ? "bg-ink font-semibold text-black" : "bg-white/[0.06] text-mute"}`}>
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-1.5">
                {health.rooms.map((r) => (
                  <button key={r.room_id} onClick={() => openRoom(home.home_id, r.room_id)} className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${selected === r.room_id ? "border-white/40 bg-white/[0.07]" : "border-line bg-white/[0.02] hover:border-white/25"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{r.name}</span>
                      <span className="text-[11px] font-semibold" style={{ color: ROOM_STATUS[r.status].color }}>
                        {ROOM_STATUS[r.status].icon} {ROOM_STATUS[r.status].label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-mute">{r.headline}</div>
                  </button>
                ))}
              </div>
              <button className="btn btn-primary mt-3 w-full" disabled={!history || !readings || !nights.length} onClick={() => setAnalytics(true)}>
                <BarChart3 size={15} /> Analytics{sel ? ` · ${sel.name}` : ""}
              </button>
              <RoomDetail report={report} sel={sel} technical={technical} chartData={chartData} cursor={player.t} onScrub={player.setT} preview={preview} setPreview={setPreview} busy={!!busy} fix={fix} />
              {busy && <div className="mt-3 text-[12.5px] text-mute pulse-dot">{busy}</div>}
              {error && <div className="mt-3 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-[12px] text-hot">{error}</div>}
              <div className="mt-3 text-[10.5px] text-dim">{health.disclaimer}</div>
            </motion.aside>
          )
        )}
      </AnimatePresence>

      <AnimatePresence>
        {analytics && history && readings && history.nights.length > 0 && (
          <Analytics
            label={home?.name ?? "Your home"}
            history={history}
            readings={readings}
            asOf={(nightIdx ?? nights.length - 1) + 1}
            setAsOf={(k) => setNightIdx(k - 1)}
            room={selected}
            setRoom={(id) => home && openRoom(home.home_id, id)}
            report={report}
            technical={technical}
            onClose={() => setAnalytics(false)}
            onShow3D={(c) => (setAnalytics(false), setPreview(c))}
          />
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
