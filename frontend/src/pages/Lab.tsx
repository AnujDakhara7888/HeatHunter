import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, CalendarDays, Fan, FastForward, Gavel, HeartPulse, Home as HomeIcon, Lock, PencilRuler, Play, Plus, SkipForward, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, traced } from "../api/client";
import type { DemoHomeCreate, DemoWeek, FixAction, HouseShape, HomeHealth, HomeHistory, HomeReadings, HomeSummary, RoomHealthView, RoomReport, RoomTechnical, Series } from "../api/types";
import { Analytics } from "../components/Analytics";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useChatContext } from "../components/ChatDock";
import { Nav } from "../components/Nav";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { FLAG_STATUSES, ROOM_STATUS, strengthOf } from "../lib/diagnosis";
import { snapAt } from "../lib/history";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { CAUSE, ROOM_NAMES, SIM_TO_PLAN, fmtDate, ms, roomColor } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";
import { toInsulation } from "../three/thermal";


function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

const LABELS_KEY = "heathunter.demoLabels";
function loadLabels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LABELS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveLabel(id: string, label: string) {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify({ ...loadLabels(), [id]: label }));
  } catch {
    /* per-browser convenience only */
  }
}
const weekName = (w: DemoWeek) =>
  `${new Date(w.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(w.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

/** A plan drawn small: every room as a rectangle, sensed rooms filled. */
function ShapeThumb({ shape }: { shape: HouseShape }) {
  const rooms = shape.plan.rooms;
  const maxX = Math.max(...rooms.map((r) => r.x + r.width));
  const maxZ = Math.max(...rooms.map((r) => r.z + r.depth));
  const k = 64 / Math.max(maxX, maxZ);
  return (
    <svg width={Math.max(8, maxX * k)} height={Math.max(8, maxZ * k)} aria-hidden className="shrink-0">
      {rooms.map((r) => (
        <rect key={r.room_id} x={r.x * k + 0.5} y={r.z * k + 0.5} width={r.width * k - 1} height={r.depth * k - 1} rx={1.5} fill={r.has_sensor === false ? "#ffffff0a" : "#ffffff26"} stroke="#ffffff55" strokeWidth={0.8} />
      ))}
    </svg>
  );
}

/** Rooms a fault can be planted in: the twin's four simulator rooms, or a plan's sensed rooms. */
function plantableRooms(shape: HouseShape): { id: string; name: string }[] {
  return shape.kind === "twin"
    ? Object.keys(SIM_TO_PLAN).map((id) => ({ id, name: ROOM_NAMES[id] }))
    : shape.plan.rooms.filter((r) => r.has_sensor !== false).map((r) => ({ id: r.room_id, name: r.name }));
}

type StartProps = {
  onStart: (req: DemoHomeCreate, label: string) => void;
  houses: HomeSummary[];
  onOpen: (h: HomeSummary) => void;
  onDelete: (h: HomeSummary) => void;
  shapes: HouseShape[];
  shape: HouseShape | null;
  onShape: (s: HouseShape) => void;
  onDeleteShape: (s: HouseShape) => void;
};

function StartCard({ onStart, houses, onOpen, onDelete, shapes, shape, onShape, onDeleteShape }: StartProps) {
  const [weeks, setWeeks] = useState<DemoWeek[]>([]);
  const [week, setWeek] = useState<DemoWeek | null>(null);
  useEffect(() => {
    traced("weeks", "GET /demo/weeks", () => api.GET("/api/demo/weeks"), (d) => `${d.length} weeks of real weather`)
      .then(setWeeks)
      .catch(() => null);
  }, []);
  const house = shape?.shape_id ?? "hh09";
  const go = (req: Omit<DemoHomeCreate, "house">, label: string) => onStart({ ...req, house, start_date: week?.start_date ?? null }, `${shape?.name ?? "HH09"} · ${label} · ${week ? weekName(week) : "random week"}`);
  const [judge, setJudge] = useState(false);
  const rooms = shape ? plantableRooms(shape) : [];
  const [room, setRoom] = useState("bedroom_1");
  useEffect(() => {
    if (shape && !plantableRooms(shape).some((r) => r.id === room)) setRoom(plantableRooms(shape)[0]?.id ?? "");
  }, [shape, room]);
  const [fault, setFault] = useState<"draft" | "envelope_conduction">("draft");
  const [severity, setSeverity] = useState(1.2); // extra heat loss on the faulty path: 1.2 = 2.2x normal
  const cards = [
    { icon: <Gavel size={18} />, title: "Judge mode", line: "You plant the fault. The app has to find it.", go: () => setJudge(true) },
    { icon: <HeartPulse size={18} />, title: "Healthy house", line: "No fault. Does the app stay calm?", go: () => go({ fault: null, random_fault: false, seed: Math.floor(Math.random() * 2 ** 31) }, "Healthy house") },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }} className="glass scroll-thin pointer-events-auto mx-auto max-h-[calc(100vh-96px)] w-[min(820px,calc(100vw-32px))] overflow-y-auto rounded-[28px] p-6">
      <div className="eyebrow">Fault Lab · simulated houses · real winter 2020-21 weather</div>
      <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.03em]">
        Watch a home, night after night. <span className="text-mute">Catch the leak.</span>
      </h1>
      {houses.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
          <HomeIcon size={13} /> Your houses:
          {houses.map((h) => (
            <span key={h.home_id} className="inline-flex items-center rounded-full border border-line hover:border-white/40">
              <button onClick={() => onOpen(h)} className="py-1 pl-2.5 pr-1.5 hover:text-ink">
                {loadLabels()[h.home_id] ?? h.name} · night {h.nights_monitored} · {h.status.replace("_", " ")}
              </button>
              <button onClick={() => onDelete(h)} className="rounded-full p-1 pr-2 text-dim hover:text-hot" aria-label="Delete this house" title="Delete this house">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <HomeIcon size={13} /> Which house? <span className="text-dim">Every shape runs the same physics and the same flag rule.</span>
        </div>
        <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {shapes.map((s) => (
            <div key={s.shape_id} className={`relative flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[11.5px] ${shape?.shape_id === s.shape_id ? "border-white/60 bg-white/10 text-ink" : "border-line text-mute hover:text-ink"}`}>
              <button onClick={() => onShape(s)} className="flex items-center gap-2.5 text-left" aria-pressed={shape?.shape_id === s.shape_id}>
                <ShapeThumb shape={s} />
                <span>
                  <span className="block font-semibold">{s.name}</span>
                  <span className="block text-dim">
                    {s.sensed_rooms} rooms · {s.kind === "twin" ? "real home's twin" : s.kind === "saved" ? "your drawing" : "preset"}
                  </span>
                </span>
              </button>
              {s.kind === "saved" && (
                <button onClick={() => onDeleteShape(s)} className="absolute right-1 top-1 rounded-full p-0.5 text-dim hover:text-hot" aria-label="Delete this saved shape" title="Delete this saved shape">
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          <Link to="/home" className="flex shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-[11.5px] text-mute hover:text-ink" title="Draw a plan in Your home, then save it as a house shape">
            <PencilRuler size={14} /> Draw your own
          </Link>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <CalendarDays size={13} /> Start in which week of winter 2020-21? <span className="text-dim">Windy weeks reveal leaks faster.</span>
        </div>
        <div className="scroll-thin mt-2 flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setWeek(null)} className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-[11.5px] ${week === null ? "border-white/60 bg-white/10 text-ink" : "border-line text-mute hover:text-ink"}`}>
            <div className="font-semibold">Random</div>
            <div className="text-dim">any week</div>
          </button>
          {weeks.map((w) => (
            <button
              key={w.start_date}
              onClick={() => setWeek(w)}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-[11.5px] ${week?.start_date === w.start_date ? "border-white/60 bg-white/10 text-ink" : "border-line text-mute hover:text-ink"}`}
            >
              <div className="font-semibold">{weekName(w)}</div>
              <div className="num text-dim">
                {w.mean_outdoor_c}°C · {w.mean_wind_m_s} m/s{w.windy_nights ? ` · ${w.windy_nights} windy` : ""}
              </div>
            </button>
          ))}
        </div>
      </div>
      {!judge ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <button key={c.title} onClick={c.go} disabled={!shape} className="rounded-2xl border border-line bg-white/[0.03] p-4 text-left transition hover:border-white/30 hover:bg-white/[0.06] disabled:opacity-50">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10">{c.icon}</div>
              <div className="mt-3 font-semibold">{c.title}</div>
              <div className="mt-1 text-[13px] leading-snug text-mute">{c.line}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="text-sm text-mute">Pick a room and a fault. The monitoring engine is never told; it has to find it from the nights alone.</div>
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setRoom(r.id)} className={`btn !py-1.5 ${room === r.id ? "btn-primary" : "btn-ghost"}`}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["draft", "envelope_conduction"] as const).map((f) => (
              <button key={f} onClick={() => setFault(f)} className={`btn !py-1.5 ${fault === f ? "btn-primary" : "btn-ghost"}`}>
                {CAUSE[f].label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm text-mute">
            Severity
            <input type="range" min={0.6} max={2} step={0.1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-48" />
            <span className="num text-ink">×{(1 + severity).toFixed(1)} normal</span>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-hot" disabled={!room} onClick={() => go({ fault: { type: fault, room_id: room, severity }, random_fault: false, seed: Math.floor(Math.random() * 2 ** 31) }, "Judge mode")}>
              <Lock size={15} /> Hide it & start
            </button>
            <button className="btn btn-ghost" onClick={() => setJudge(false)}>
              Back
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatusChip({ status }: { status: keyof typeof ROOM_STATUS }) {
  const s = ROOM_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: s.color, background: `${s.color}1f` }}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export default function Lab() {
  const set = useScene((s) => s.set);
  const [label, setLabel] = useState("");
  const [home, setHome] = useState<HomeSummary | null>(null);
  const [health, setHealth] = useState<HomeHealth | null>(null);
  const [readings, setReadings] = useState<HomeReadings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<RoomReport | null>(null);
  const [technical, setTechnical] = useState<RoomTechnical | null>(null);
  const [nightIdx, setNightIdx] = useState<number | null>(null);
  const [windDirs, setWindDirs] = useState<Record<string, Series | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [houses, setHouses] = useState<HomeSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [weekRun, setWeekRun] = useState<{ done: number; total: number } | null>(null);
  const stopWeek = useRef(false);
  const [weekPlay, setWeekPlay] = useState<number | null>(null);
  const [history, setHistory] = useState<HomeHistory | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [shapes, setShapes] = useState<HouseShape[]>([]);
  const [shape, setShape] = useState<HouseShape | null>(null);
  // The HH09 twin's simulator rooms have their own ids (bedroom_1 = the plan's bedroom); plan shapes use plan ids.
  const isTwin = !shape || shape.kind === "twin";
  const toPlan = useCallback((id: string) => (isTwin ? SIM_TO_PLAN[id] ?? id : id), [isTwin]);

  const loadShapes = () =>
    traced("shapes", "GET /house-shapes", () => api.GET("/api/house-shapes"), (d) => `${d.length} house shapes`)
      .then((all) => {
        setShapes(all);
        setShape((cur) => all.find((x) => x.shape_id === cur?.shape_id) ?? all.find((x) => x.kind === "twin") ?? null);
        return all;
      })
      .catch(() => [] as HouseShape[]);
  useEffect(() => {
    void loadShapes();
  }, []);
  // The 3D house follows the chosen shape (and the twin keeps its documented compass bearing).
  useEffect(() => {
    if (!shape) return;
    set({
      plan: shape.kind === "twin" ? HH09_PLAN : shape.plan,
      zBearing: shape.kind === "twin" ? HH09_Z_BEARING : null,
      names: shape.kind === "twin" ? {} : Object.fromEntries(shape.plan.rooms.map((r) => [r.room_id, r.name])),
    });
  }, [shape, set]);

  const loadHouses = () =>
    traced("homes", "GET /homes", () => api.GET("/api/homes"), (d) => `${d.length} houses`)
      .then((all) => setHouses(all.filter((h) => h.kind === "demo")))
      .catch(() => null);
  useEffect(() => {
    void loadHouses();
  }, []);

  useEffect(() => {
    set({ plan: HH09_PLAN, view: "exterior", finding: null, focusRoom: null, fanOn: false, labels: true, autoRotate: true, names: {}, inset: 0, ir: false, zBearing: HH09_Z_BEARING, windFrom: null });
    useTrace.getState().clear();
    return () => useChatContext.getState().setHome(null);
  }, [set]);

  const nights = readings?.nights ?? [];
  const night = nights.length ? nights[nightIdx ?? nights.length - 1] : null;
  const window_ = night ? ([ms(night.start), ms(night.end)] as [number, number]) : null;
  const roomsPlan = useMemo(() => {
    if (!readings || !window_) return null;
    return Object.fromEntries(Object.entries(readings.rooms).map(([k, r]) => [toPlan(k), slice(r.measured, ...window_)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, window_?.[0]]);
  const outdoor = useMemo(() => (readings && window_ ? slice(readings.outdoor_temperature, ...window_) : null), [readings, window_?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const wind = useMemo(() => (readings && window_ ? slice(readings.wind_speed, ...window_) : null), [readings, window_?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = night?.night_id;
    if (!id || id in windDirs) return;
    traced("wind", "GET /weather/{night}/wind-direction", () => api.GET("/api/weather/{night_id}/wind-direction", { params: { path: { night_id: id } } }), (s) => `${s.values.length} measured directions`)
      .then((s) => setWindDirs((c) => ({ ...c, [id]: s })))
      .catch(() => setWindDirs((c) => ({ ...c, [id]: null })));
  }, [night?.night_id, windDirs]);
  const player = useNight(roomsPlan, outdoor, wind, weekPlay != null ? 6 : 10, night ? windDirs[night.night_id] : null);
  useEffect(() => set({ insulation: readings?.insulation ? toInsulation(readings.insulation, isTwin ? SIM_TO_PLAN : {}) : null }), [readings, isTwin, set]);
  useEffect(() => {
    if (weekPlay == null || player.playing || !player.range || player.t == null || player.t < player.range[1] - 1) return;
    const next = (nightIdx ?? nights.length - 1) + 1;
    if (next < Math.min(nights.length, weekPlay * 7 + 7)) {
      setNightIdx(next);
      setTimeout(() => player.play(), 250);
    } else setWeekPlay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.playing, player.t, weekPlay]);

  const fanRunning = night?.kind === "fan_test" && player.t != null && player.t >= ms(night.start) + 3.6e6 && player.t <= ms(night.start) + 3 * 3.6e6;
  useEffect(() => set({ fanOn: fanRunning }), [fanRunning, set]);

  // Rooms as the app saw them after the selected night: looking back never shows later evidence.
  const asOf = (nightIdx ?? nights.length - 1) + 1;
  const latest = asOf >= nights.length;
  const rooms: RoomHealthView[] = useMemo(() => {
    if (!health) return [];
    if (latest || !history) return health.rooms;
    return health.rooms.map((r) => {
      const s = snapAt(history.rooms.find((h) => h.room_id === r.room_id), asOf);
      return {
        ...r,
        status: s?.status ?? "not_enough_data",
        likely_cause: s?.named_cause ?? null,
        extra_heat_loss_percent: s && FLAG_STATUSES.includes(s.status) ? Math.round(s.extra_heat_loss_percent) : null,
        annual_cost_gbp: s?.annual_cost_gbp ?? null,
        nights_seen: s?.nights_judged ?? 0,
        headline: "",
      };
    });
  }, [health, history, asOf, latest]);

  // The room the app is worried about drives the 3D finding.
  const flaggedRoom = rooms.find((r) => FLAG_STATUSES.includes(r.status));
  useEffect(() => {
    const r = selected ? rooms.find((x) => x.room_id === selected) : flaggedRoom;
    const target = r && FLAG_STATUSES.includes(r.status) ? r : flaggedRoom;
    if (!target || target.status === "verifying") {
      set({ finding: target ? { room: toPlan(target.room_id), cause: null, strength: 0.3 } : null });
      return;
    }
    set({ finding: { room: toPlan(target.room_id), cause: target.likely_cause ?? null, strength: strengthOf(target.extra_heat_loss_percent), extra: (target.extra_heat_loss_percent ?? 0) / 100 } });
  }, [rooms, selected, flaggedRoom, toPlan, set]);

  // The server builds the assistant's context itself; we only tell the dock which home is on screen.
  useEffect(() => {
    useChatContext.getState().setHome(home?.home_id ?? null);
    useChatContext.getState().setContext(
      {
        page: `Fault Lab: simulated ${shape?.name ?? "HH09 twin"} watched night after night`,
        nights: nights.length,
        selected_room_id: report?.room_id,
        visible_window: night ? { start: night.start, end: night.end } : undefined,
        rooms: health?.rooms.map((r) => `${r.name}: ${ROOM_STATUS[r.status].label} — ${r.headline}`),
        selected_room: report && { name: report.name, headline: report.headline, why: report.why, what_to_do: report.what_to_do, money: report.money && { annual_cost_gbp: report.money.annual_cost_gbp, repair_cost_gbp: report.money.repair_cost_gbp, payback_years: report.money.payback_years } },
      },
      ["Which room is the problem?", "Why do several nights matter?", "Is it worth fixing?"],
    );
  }, [home, health, report, nights.length, night?.night_id, shape?.name]);

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

  const refresh = async (homeId: string, h: HomeHealth, focus?: string | null) => {
    setHealth(h);
    setHome(h.home);
    const [r, hist] = await Promise.all([
      traced("readings", "GET /homes/{id}/readings", () => api.GET("/api/homes/{home_id}/readings", { params: { path: { home_id: homeId } } }), (d) => `${d.nights.length} nights · expected-if-healthy lines`),
      traced("history", "GET /homes/{id}/history", () => api.GET("/api/homes/{home_id}/history", { params: { path: { home_id: homeId } } }), (d) => `${d.rooms.length} rooms × ${d.nights.length} nights`).catch(() => null),
    ]);
    setReadings(r);
    setHistory(hist);
    setNightIdx(null);
    const room = focus ?? selected ?? h.rooms.find((x) => FLAG_STATUSES.includes(x.status))?.room_id ?? null;
    if (room) await openRoom(homeId, room);
  };

  const openRoom = async (homeId: string, roomId: string) => {
    setSelected(roomId);
    set({ focusRoom: toPlan(roomId) });
    const [rep, tech] = await Promise.all([
      traced("room", "GET /rooms/{room}", () => api.GET("/api/homes/{home_id}/rooms/{room_id}", { params: { path: { home_id: homeId, room_id: roomId } } }), (d) => ROOM_STATUS[d.status].label),
      traced("tech", "GET /rooms/{room}/technical", () => api.GET("/api/homes/{home_id}/rooms/{room_id}/technical", { params: { path: { home_id: homeId, room_id: roomId } } }), (d) => `${d.fits.length} fits over ${d.nights_judged} nights`).catch(() => null),
    ]);
    setReport(rep);
    setTechnical(tech);
  };

  const start = (req: DemoHomeCreate, name: string) =>
    run("Setting up the house…", async () => {
      for (const reset of [setHealth, setReadings, setReport, setTechnical, setSelected, setHistory] as ((v: null) => void)[]) reset(null);
      const h = await traced("create", "POST /demo/homes", () => api.POST("/api/demo/homes", { body: req }), (d) => d.home_id);
      setHome(h);
      setLabel(name);
      saveLabel(h.home_id, name);
      setPicking(false);
      set({ view: "open", autoRotate: false, inset: 460, focusRoom: null });
      await advance(h.home_id, 1);
      void loadHouses();
    });

  const advance = async (homeId: string, n: number) => {
    const h = await traced("advance", `POST /demo/homes/{id}/advance ×${n}`, () => api.POST("/api/demo/homes/{home_id}/advance", { params: { path: { home_id: homeId } }, body: { nights: n } }), (d) => `night ${d.home.nights_monitored} · ${d.home.status}`);
    await refresh(homeId, h);
    setTimeout(() => player.play(), 300);
  };

  /** Switch to another house: each keeps its own nights, statuses and repairs on the server. */
  const openHouse = (h: HomeSummary) =>
    run("Opening the house…", async () => {
      for (const reset of [setReport, setTechnical, setSelected, setHistory] as ((v: null) => void)[]) reset(null);
      setPicking(false);
      setLabel(loadLabels()[h.home_id] ?? h.name);
      setShape(shapes.find((x) => x.shape_id === (h.shape_id ?? "hh09")) ?? shapes.find((x) => x.kind === "twin") ?? null);
      set({ view: "open", autoRotate: false, inset: 460, focusRoom: null });
      const hh = await traced("health", "GET /homes/{id}", () => api.GET("/api/homes/{home_id}", { params: { path: { home_id: h.home_id } } }), (d) => `${d.home.nights_monitored} nights · ${d.home.status}`);
      if (hh.home.nights_monitored === 0) await advance(h.home_id, 1);
      else await refresh(h.home_id, hh);
    });

  /** A week, night by night, so the evidence visibly builds up; "Skip to end" runs the rest at once. */
  const runWeek = async () => {
    if (!home) return;
    const total = Math.min(7, 28 - home.nights_monitored);
    stopWeek.current = false;
    setError(null);
    try {
      for (let k = 0; k < total; k++) {
        setWeekRun({ done: k, total });
        if (stopWeek.current) {
          await advance(home.home_id, total - k);
          break;
        }
        await advance(home.home_id, 1);
        await new Promise((r) => setTimeout(r, 900));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWeekRun(null);
      void loadHouses();
    }
  };

  const fix = (action: FixAction) =>
    run("Recording your repair…", async () => {
      const rep = await traced("fix", "POST /rooms/{room}/fix", () => api.POST("/api/homes/{home_id}/rooms/{room_id}/fix", { params: { path: { home_id: home!.home_id, room_id: selected! } }, body: { action } }), (d) => ROOM_STATUS[d.status].label);
      setReport(rep);
      const h = await traced("health", "GET /homes/{id}", () => api.GET("/api/homes/{home_id}", { params: { path: { home_id: home!.home_id } } }), (d) => d.home.status);
      setHealth(h);
      setHome(h.home);
      setHistory(await api.GET("/api/homes/{home_id}/history", { params: { path: { home_id: home!.home_id } } }).then((x) => x.data ?? null));
    });

  /** Run tonight as a fan test: it only helps name an unclear cause, it never raises an alarm. */
  const fanTest = () =>
    run("Running a fan test tonight…", async () => {
      const h = await traced("fan", "POST /demo/homes/{id}/fan-test", () => api.POST("/api/demo/homes/{home_id}/fan-test", { params: { path: { home_id: home!.home_id } } }), (d) => `night ${d.home.nights_monitored} · fan test`);
      await refresh(home!.home_id, h);
      setTimeout(() => player.play(), 300);
    });

  /** Forget a simulated house and all its nights; back to the start card if it was on screen. */
  const removeHouse = (h: HomeSummary) => {
    if (!window.confirm(`Delete "${loadLabels()[h.home_id] ?? h.name}" and all its nights? This cannot be undone.`)) return;
    void run("Deleting the house…", async () => {
      const { response } = await api.DELETE("/api/homes/{home_id}", { params: { path: { home_id: h.home_id } } });
      if (!response.ok && response.status !== 404) throw new Error(`Could not delete the house (HTTP ${response.status})`);
      if (home?.home_id === h.home_id) {
        setHome(null);
        setHealth(null);
        setPicking(false);
        set({ view: "exterior", autoRotate: true, inset: 0, finding: null, focusRoom: null });
      }
      await loadHouses();
    });
  };

  /** Delete a saved house shape (refused while a demo house still uses it). */
  const removeShape = (x: HouseShape) => {
    if (!window.confirm(`Delete the saved shape "${x.name}"?`)) return;
    void run("Deleting the shape…", async () => {
      const { response, error: body } = await api.DELETE("/api/house-shapes/{shape_id}", { params: { path: { shape_id: x.shape_id } } });
      if (!response.ok) throw new Error((body as { detail?: string } | undefined)?.detail ?? `Could not delete the shape (HTTP ${response.status})`);
      await loadShapes();
    });
  };

  const sel = rooms.find((r) => r.room_id === selected);
  const canFix = latest && sel && ["issue", "issue_cause_unclear", "still_an_issue"].includes(sel.status);

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <Nav transparent />
      <HouseCanvas className="absolute inset-0" focusControl />

      {home && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center gap-2 pr-[460px]">
          <ViewSwitcher views={["exterior", "thermal", "open", "inside"]} className="pointer-events-auto" />
          <button className="glass pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold hover:bg-white/10 disabled:opacity-40" disabled={!history || !readings} onClick={() => setAnalytics(true)}>
            <BarChart3 size={14} /> Analytics
          </button>
        </div>
      )}
      <AnimatePresence>
        {analytics && history && readings && (
          <ErrorBoundary title="Analytics hit a problem showing this night." resetLabel="Back to the house" onReset={() => setAnalytics(false)}>
          <Analytics
            label={label}
            history={history}
            readings={readings}
            asOf={asOf}
            setAsOf={(k) => (setWeekPlay(null), setNightIdx(k - 1))}
            room={selected}
            setRoom={(id) => home && openRoom(home.home_id, id)}
            report={report}
            technical={technical}
            onClose={() => setAnalytics(false)}
            planRoom={toPlan}
          />
          </ErrorBoundary>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!home && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-end gap-3 pb-[8vh]">
            {(busy || error) && <div className={`glass rounded-full px-4 py-2 text-[13px] ${error ? "text-hot" : "text-mute"}`}>{error ?? busy}</div>}
            <StartCard onStart={start} houses={houses} onOpen={openHouse} onDelete={removeHouse} shapes={shapes} shape={shape} onShape={setShape} onDeleteShape={removeShape} />
          </div>
        )}
      </AnimatePresence>

      {home && health && (
        <motion.aside initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 flex w-[min(440px,calc(100vw-32px))] flex-col overflow-y-auto rounded-[26px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => (setPicking((v) => !v), void loadHouses())}
                disabled={!!weekRun || !!busy}
                className="eyebrow inline-flex items-center gap-1 hover:text-ink disabled:opacity-50"
                title={weekRun ? "Finish or skip the week first" : "Switch house"}
              >
                <HomeIcon size={11} /> {label} ▾
              </button>
              <div className="mt-0.5 text-[26px] font-bold tracking-tight">
                Night {home.nights_monitored}
                {home.last_night && <span className="ml-2 text-[13px] font-normal text-mute">{fmtDate(ms(home.last_night))}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button className="btn btn-primary !px-3 !py-2" disabled={!!busy || home.nights_monitored >= 28} onClick={() => run("Simulating the next night…", () => advance(home.home_id, 1))} title="Next night">
                <SkipForward size={15} /> Next night
              </button>
              <button className="btn btn-ghost !px-3 !py-2" disabled={!!busy || !!weekRun || home.nights_monitored >= 28} onClick={runWeek} title="Run a week">
                <FastForward size={15} /> Week
              </button>
            </div>
          </div>
          {weekRun && (
            <div className="mt-2 flex items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2 text-[12px]">
              <div className="h-1.5 flex-1 rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-ink" animate={{ width: `${((weekRun.done + 1) / weekRun.total) * 100}%` }} />
              </div>
              <span className="num text-mute">
                night {weekRun.done + 1}/{weekRun.total}
              </span>
              <button className="text-mute underline hover:text-ink" onClick={() => (stopWeek.current = true)}>
                Skip to end
              </button>
            </div>
          )}
          <AnimatePresence>
            {picking && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 space-y-1 rounded-2xl border border-line bg-black/30 p-2">
                {houses.map((h) => (
                  <div key={h.home_id} className={`flex items-center rounded-xl text-[12px] ${h.home_id === home.home_id ? "bg-white/10 text-ink" : "text-mute hover:bg-white/5 hover:text-ink"}`}>
                    <button onClick={() => openHouse(h)} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-1.5 text-left">
                      <span className="truncate">{loadLabels()[h.home_id] ?? h.name}</span>
                      <span className="num shrink-0 text-dim">
                        night {h.nights_monitored} · {h.status.replace("_", " ")}
                      </span>
                    </button>
                    <button onClick={() => removeHouse(h)} className="shrink-0 rounded-lg p-1.5 text-dim hover:text-hot" aria-label="Delete this house" title="Delete this house">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={() => (setHome(null), setHealth(null), setPicking(false), set({ view: "exterior", autoRotate: true, inset: 0, finding: null, focusRoom: null }))} className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] text-ink hover:bg-white/5">
                  <Plus size={13} /> New house (keeps these)
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* nights, grouped into weeks */}
          <div className="mt-3 space-y-1.5">
            {Array.from({ length: Math.ceil(nights.length / 7) }, (_, w) => (
              <div key={w} className="flex items-center gap-1">
                <button
                  onClick={() => (weekPlay === w ? setWeekPlay(null) : (setWeekPlay(w), setNightIdx(w * 7), setTimeout(() => player.play(), 100)))}
                  className={`flex h-7 w-[74px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] ${weekPlay === w ? "bg-warm/20 text-warm" : "bg-white/[0.04] text-mute hover:text-ink"}`}
                  title="Play this week's nights back to back"
                >
                  {weekPlay === w ? <Square size={10} /> : <Play size={10} />} Week {w + 1}
                </button>
                {nights.slice(w * 7, w * 7 + 7).map((n, j) => {
                  const i = w * 7 + j;
                  return (
                    <button
                      key={n.night_id}
                      onClick={() => (setWeekPlay(null), setNightIdx(i), setTimeout(() => player.play(), 100))}
                      title={`${n.night_id.replace("hh09-night-", "")} · ${n.mean_outdoor_c.toFixed(1)}°C · wind ${n.mean_wind_m_s.toFixed(1)} m/s${n.kind === "fan_test" ? " · fan test" : ""}`}
                      className={`num h-7 min-w-7 rounded-md px-1.5 text-[11px] ${i === (nightIdx ?? nights.length - 1) ? "bg-ink font-semibold text-black" : n.kind === "fan_test" ? "bg-[#103a40] text-[#7fe0f0] hover:text-ink" : n.mean_wind_m_s >= 4 ? "bg-[#1c2a44] text-[#9cc8ff] hover:text-ink" : "bg-white/[0.06] text-mute hover:text-ink"}`}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="text-[10px] text-dim">
              Blue nights were windy (≥ 4 m/s){nights.some((x) => x.kind === "fan_test") ? "; teal nights were fan tests" : ""}. Play a week to watch its nights back to back.
            </div>
          </div>

          {/* rooms, as of the selected night */}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-[11px] text-mute">{latest ? "Rooms now" : `Rooms as of night ${asOf}`}</div>
            {!latest && (
              <button className="text-[11px] text-warm underline" onClick={() => setNightIdx(null)}>
                back to latest
              </button>
            )}
          </div>
          <div className="mt-1.5 space-y-1">
            {rooms.map((r) => {
              const h = history?.rooms.find((x) => x.room_id === r.room_id);
              return (
                <button
                  key={r.room_id}
                  onClick={() => openRoom(home.home_id, r.room_id)}
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${selected === r.room_id ? "border-white/40 bg-white/[0.07]" : "border-line bg-white/[0.02] hover:border-white/25"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <i className="h-2 w-2 rounded-full" style={{ background: roomColor(toPlan(r.room_id)) }} />
                      {r.name}
                    </span>
                    <StatusChip status={r.status} />
                  </div>
                  {h && (
                    <div className="mt-1.5 flex gap-[3px]" aria-hidden>
                      {nights.map((_, i) => {
                        const s = i < asOf ? h.snapshots.find((x) => x.night_number === i + 1) : undefined;
                        return <i key={i} className="h-1.5 flex-1 rounded-full" style={{ background: s ? ROOM_STATUS[s.status].color : "#ffffff12", opacity: s?.status === "healthy" ? 0.35 : 1 }} />;
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* selected room: only what acts on the house */}
          {sel && (
            <div className="mt-3 space-y-2.5 rounded-2xl border border-line bg-black/20 p-3">
              <div className="text-[13px] leading-snug">
                <b>{sel.name}</b>
                <span className="text-mute">
                  {sel.extra_heat_loss_percent != null && ` · +${sel.extra_heat_loss_percent}% heat loss`}
                  {sel.likely_cause && ` · likely ${CAUSE[sel.likely_cause].label.toLowerCase()}`}
                  {sel.annual_cost_gbp != null && ` · £${Math.round(sel.annual_cost_gbp)}/yr`}
                </span>
              </div>
              {latest && report?.fan_test_available && report.room_id === sel.room_id && (
                <div className="rounded-xl border border-[#2fc6d9]/40 bg-[#2fc6d9]/10 p-2.5">
                  <div className="text-[11.5px] leading-snug text-[#bdeef5]">
                    Leak or walls? Not clear yet. A fan test usually settles it: tonight an extractor fan runs for 2 hours and pulls extra outside air through any gaps.
                  </div>
                  <button className="btn btn-primary mt-2 w-full !py-1.5 !text-[12px]" disabled={!!busy} onClick={fanTest}>
                    <Fan size={14} /> Run a fan test tonight
                  </button>
                </div>
              )}
              {canFix && (
                <div>
                  <div className="mb-1 text-[11px] text-mute">Do a repair, then keep watching:</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      ["seal_leaks", "Seal leaks"],
                      ["add_insulation", "Insulate"],
                      ["other", "Other"],
                    ] as [FixAction, string][]).map(([a, l]) => (
                      <button key={a} className={`btn !px-2 !py-1.5 !text-[12px] ${(sel.likely_cause === "draft" && a === "seal_leaks") || (sel.likely_cause === "envelope_conduction" && a === "add_insulation") ? "btn-hot" : "btn-ghost"}`} disabled={!!busy} onClick={() => fix(a)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {latest && report?.fix && report.room_id === sel.room_id && (
                <div className="text-[11.5px] text-mute">
                  Repair: <b className="text-ink">{report.fix.action.replace("_", " ")}</b> · {report.fix.nights_since_fix} night{report.fix.nights_since_fix === 1 ? "" : "s"} since{report.status === "verifying" ? ". Press Next night to check it." : "."}
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary mt-3 w-full" disabled={!history || !readings} onClick={() => setAnalytics(true)}>
            <BarChart3 size={15} /> Analytics{sel ? ` · ${sel.name}` : ""}
          </button>


          {busy && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] text-mute">
              <span className="h-2 w-2 rounded-full bg-warm pulse-dot" /> {busy}
            </div>
          )}
          {error && <div className="mt-3 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-[12px] text-hot">{error}</div>}
          <div className="mt-3 text-[10.5px] text-dim">{health.disclaimer}</div>
        </motion.aside>
      )}

      {home && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-[476px] z-20 flex flex-col gap-2">
          <Timeline
            className="pointer-events-auto max-w-[640px]"
            {...player}
            onPlay={player.play}
            onPause={player.pause}
            onScrub={player.setT}
            caption={night ? `Night ${(nightIdx ?? nights.length - 1) + 1} · heating off${night.kind === "fan_test" ? " · fan test, extractor on 23:00–01:00" : ""} · real winter 2020-21 weather · ${night.mean_outdoor_c.toFixed(1)}°C avg` : "No nights yet"}
          />
        </div>
      )}
    </div>
  );
}
