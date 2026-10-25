import { AnimatePresence, motion } from "framer-motion";
import { Dice5, Eye, FastForward, Gavel, HeartPulse, Lock, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, traced } from "../api/client";
import type { DemoHomeCreate, DemoReveal, FixAction, HomeHealth, HomeReadings, HomeSummary, RoomReport, RoomTechnical, Series } from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { EngineTrace } from "../components/EngineTrace";
import { RoomDetail } from "../components/RoomDetail";
import { LineChart } from "../components/LineChart";
import { Nav } from "../components/Nav";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { FLAG_STATUSES, ROOM_STATUS, strengthOf } from "../lib/diagnosis";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { CAUSE, ROOM_NAMES, SIM_TO_PLAN, fmtDate, ms, type CauseKey } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";

const roomName = (id: string | null | undefined) => (id ? ROOM_NAMES[id] ?? id : "–");

function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

function StartCard({ onStart }: { onStart: (req: DemoHomeCreate, label: string) => void }) {
  const [judge, setJudge] = useState(false);
  const [room, setRoom] = useState("bedroom_1");
  const [fault, setFault] = useState<"draft" | "envelope_conduction">("draft");
  const [severity, setSeverity] = useState(1.8);
  const cards = [
    { icon: <Dice5 size={18} />, title: "Hidden fault", line: "A random fault, room and severity. Or none at all.", go: () => onStart({ house: "hh09", random_fault: true, seed: Math.floor(Math.random() * 2 ** 31) }, "Hidden random fault") },
    { icon: <Gavel size={18} />, title: "Judge mode", line: "You plant the fault. The app has to find it.", go: () => setJudge(true) },
    { icon: <HeartPulse size={18} />, title: "Healthy house", line: "No fault. Does the app stay calm?", go: () => onStart({ house: "hh09", fault: null, random_fault: false, seed: Math.floor(Math.random() * 2 ** 31) }, "Healthy house") },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }} className="glass pointer-events-auto mx-auto w-[min(760px,calc(100vw-32px))] rounded-[28px] p-6">
      <div className="eyebrow">Fault Lab · digital twin of a real UK home · real winter 2020-21 weather</div>
      <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.03em]">
        Watch a home, night after night. <span className="text-mute">Catch the leak.</span>
      </h1>
      {!judge ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <button key={c.title} onClick={c.go} className="rounded-2xl border border-line bg-white/[0.03] p-4 text-left transition hover:border-white/30 hover:bg-white/[0.06]">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10">{c.icon}</div>
              <div className="mt-3 font-semibold">{c.title}</div>
              <div className="mt-1 text-[13px] leading-snug text-mute">{c.line}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="text-sm text-mute">Pick it in secret. The monitoring engine never sees it; only the reveal does.</div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SIM_TO_PLAN).map((id) => (
              <button key={id} onClick={() => setRoom(id)} className={`btn !py-1.5 ${room === id ? "btn-primary" : "btn-ghost"}`}>
                {ROOM_NAMES[id]}
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
            <input type="range" min={1.2} max={3} step={0.1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-48" />
            <span className="num text-ink">×{severity.toFixed(1)}</span>
          </label>
          <div className="flex gap-2">
            <button className="btn btn-hot" onClick={() => onStart({ house: "hh09", fault: { type: fault, room_id: room, severity }, random_fault: false, seed: Math.floor(Math.random() * 2 ** 31) }, "Judge mode")}>
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
  const [reveal, setReveal] = useState<DemoReveal | null>(null);
  const [nightIdx, setNightIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<CauseKey | null>(null);
  const [windDirs, setWindDirs] = useState<Record<string, Series | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    return Object.fromEntries(Object.entries(readings.rooms).map(([k, r]) => [SIM_TO_PLAN[k] ?? k, slice(r.measured, ...window_)]));
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
  const player = useNight(roomsPlan, outdoor, wind, 10, night ? windDirs[night.night_id] : null);

  // The room the app is worried about drives the 3D finding (or the user's preview).
  const flaggedRoom = health?.rooms.find((r) => FLAG_STATUSES.includes(r.status));
  useEffect(() => {
    const r = selected ? health?.rooms.find((x) => x.room_id === selected) : flaggedRoom;
    const target = r && FLAG_STATUSES.includes(r.status) ? r : flaggedRoom;
    if (preview && (target || selected)) {
      const room = (target ?? r)!.room_id;
      set({ finding: preview === "normal" ? null : { room: SIM_TO_PLAN[room], cause: preview, strength: strengthOf(target?.extra_heat_loss_percent ?? 25) } });
      return;
    }
    if (!target || target.status === "verifying") {
      set({ finding: target ? { room: SIM_TO_PLAN[target.room_id], cause: null, strength: 0.3 } : null });
      return;
    }
    set({ finding: { room: SIM_TO_PLAN[target.room_id], cause: target.likely_cause ?? null, strength: strengthOf(target.extra_heat_loss_percent) } });
  }, [health, selected, preview, flaggedRoom, set]);

  // The server builds the assistant's context itself; we only tell the dock which home is on screen.
  useEffect(() => {
    useChatContext.getState().setHome(home?.home_id ?? null);
    useChatContext.getState().setContext(
      {
        page: "Fault Lab: simulated HH09 twin watched night after night",
        nights: nights.length,
        rooms: health?.rooms.map((r) => `${r.name}: ${ROOM_STATUS[r.status].label} — ${r.headline}`),
        selected_room: report && { name: report.name, headline: report.headline, why: report.why, what_to_do: report.what_to_do, money: report.money && { annual_cost_gbp: report.money.annual_cost_gbp, repair_cost_gbp: report.money.repair_cost_gbp, payback_years: report.money.payback_years } },
        revealed_truth: reveal ? reveal.summary : "not revealed yet",
      },
      ["Which room is the problem?", "Why do several nights matter?", "Is it worth fixing?"],
    );
  }, [home, health, report, reveal, nights.length]);

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
    const r = await traced("readings", "GET /homes/{id}/readings", () => api.GET("/api/homes/{home_id}/readings", { params: { path: { home_id: homeId } } }), (d) => `${d.nights.length} nights · expected-if-healthy lines`);
    setReadings(r);
    setNightIdx(null);
    const room = focus ?? selected ?? h.rooms.find((x) => FLAG_STATUSES.includes(x.status))?.room_id ?? null;
    if (room) await openRoom(homeId, room);
  };

  const openRoom = async (homeId: string, roomId: string) => {
    setSelected(roomId);
    setPreview(null);
    set({ focusRoom: SIM_TO_PLAN[roomId] });
    const [rep, tech] = await Promise.all([
      traced("room", "GET /rooms/{room}", () => api.GET("/api/homes/{home_id}/rooms/{room_id}", { params: { path: { home_id: homeId, room_id: roomId } } }), (d) => ROOM_STATUS[d.status].label),
      traced("tech", "GET /rooms/{room}/technical", () => api.GET("/api/homes/{home_id}/rooms/{room_id}/technical", { params: { path: { home_id: homeId, room_id: roomId } } }), (d) => `${d.fits.length} fits over ${d.nights_judged} nights`).catch(() => null),
    ]);
    setReport(rep);
    setTechnical(tech);
  };

  const start = (req: DemoHomeCreate, name: string) =>
    run("Setting up the house…", async () => {
      for (const reset of [setHealth, setReadings, setReport, setTechnical, setReveal, setSelected] as ((v: null) => void)[]) reset(null);
      const h = await traced("create", "POST /demo/homes", () => api.POST("/api/demo/homes", { body: req }), (d) => d.home_id);
      setHome(h);
      setLabel(name);
      set({ view: "open", autoRotate: false, inset: 460, focusRoom: null });
      await advance(h.home_id, 1);
    });

  const advance = async (homeId: string, n: number) => {
    const h = await traced("advance", `POST /demo/homes/{id}/advance ×${n}`, () => api.POST("/api/demo/homes/{home_id}/advance", { params: { path: { home_id: homeId } }, body: { nights: n } }), (d) => `night ${d.home.nights_monitored} · ${d.home.status}`);
    await refresh(homeId, h);
    setTimeout(() => player.play(), 300);
  };

  const fix = (action: FixAction) =>
    run("Recording your repair…", async () => {
      const rep = await traced("fix", "POST /rooms/{room}/fix", () => api.POST("/api/homes/{home_id}/rooms/{room_id}/fix", { params: { path: { home_id: home!.home_id, room_id: selected! } }, body: { action } }), (d) => ROOM_STATUS[d.status].label);
      setReport(rep);
      const h = await traced("health", "GET /homes/{id}", () => api.GET("/api/homes/{home_id}", { params: { path: { home_id: home!.home_id } } }), (d) => d.home.status);
      setHealth(h);
      setHome(h.home);
    });

  const doReveal = () =>
    run("Opening the envelope…", async () => {
      const r = await traced("reveal", "GET /demo/homes/{id}/reveal", () => api.GET("/api/demo/homes/{home_id}/reveal", { params: { path: { home_id: home!.home_id } } }), (d) => (d.app_found_it ? "found" : "missed"));
      setReveal(r);
    });

  const sel = health?.rooms.find((r) => r.room_id === selected);
  const roomReadings = selected && readings ? readings.rooms[selected] : null;
  const chartData =
    roomReadings && window_
      ? [
          { id: "m", label: `${roomName(selected)} measured`, color: "#f2f3f5", series: slice(roomReadings.measured, ...window_), width: 2 },
          ...(roomReadings.expected_if_healthy ? [{ id: "e", label: "Expected if healthy", color: "#2fd18b", series: slice(roomReadings.expected_if_healthy, ...window_), dashed: true }] : []),
          ...(outdoor ? [{ id: "o", label: "Outside", color: "#8a90a2", series: outdoor, dashed: true, width: 1.5 }] : []),
        ]
      : null;

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <Nav transparent />
      <HouseCanvas className="absolute inset-0" />

      {home && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center pr-[460px]">
          <ViewSwitcher views={["exterior", "thermal", "open", "inside"]} className="pointer-events-auto" />
        </div>
      )}
      <AnimatePresence>
        {preview && sel && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 top-[166px] z-20 flex justify-center pr-[460px]">
            <div className="glass pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[12.5px]">
              <span>
                Previewing <b style={{ color: CAUSE[preview].color }}>{CAUSE[preview].label.toLowerCase()}</b>
                <span className="text-mute"> · {preview === sel.likely_cause ? "the app's likely cause" : "an alternative"}</span>
              </span>
              <button onClick={() => setPreview(null)} className="rounded-full bg-ink px-3 py-1 font-semibold text-black">
                Back to the app's view
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!home && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-end gap-3 pb-[8vh]">
            {(busy || error) && <div className={`glass rounded-full px-4 py-2 text-[13px] ${error ? "text-hot" : "text-mute"}`}>{error ?? busy}</div>}
            <StartCard onStart={start} />
          </div>
        )}
      </AnimatePresence>

      {home && health && (
        <motion.aside initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 flex w-[min(440px,calc(100vw-32px))] flex-col overflow-y-auto rounded-[26px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow">{label} · {home.home_id}</div>
              <div className="mt-0.5 text-[26px] font-bold tracking-tight">
                Night {home.nights_monitored}
                {home.last_night && <span className="ml-2 text-[13px] font-normal text-mute">{fmtDate(ms(home.last_night))}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button className="btn btn-primary !px-3 !py-2" disabled={!!busy || home.nights_monitored >= 28} onClick={() => run("Simulating the next night…", () => advance(home.home_id, 1))} title="Next night">
                <SkipForward size={15} /> Next night
              </button>
              <button className="btn btn-ghost !px-3 !py-2" disabled={!!busy || home.nights_monitored >= 26} onClick={() => run("Simulating 3 nights…", () => advance(home.home_id, 3))} title="Three nights">
                <FastForward size={15} /> 3
              </button>
            </div>
          </div>

          {/* nights strip */}
          <div className="mt-3 flex flex-wrap gap-1">
            {nights.map((n, i) => (
              <button
                key={n.night_id}
                onClick={() => (setNightIdx(i), setTimeout(() => player.play(), 100))}
                title={`${n.night_id.replace("hh09-night-", "")} · ${n.mean_outdoor_c.toFixed(1)}°C · wind ${n.mean_wind_m_s.toFixed(1)} m/s`}
                className={`num h-7 min-w-7 rounded-md px-1.5 text-[11px] ${i === (nightIdx ?? nights.length - 1) ? "bg-ink font-semibold text-black" : "bg-white/[0.06] text-mute hover:text-ink"}`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {/* rooms */}
          <div className="mt-4 space-y-1.5">
            {health.rooms.map((r) => (
              <button
                key={r.room_id}
                onClick={() => openRoom(home.home_id, r.room_id)}
                className={`w-full rounded-2xl border px-3 py-2.5 text-left transition ${selected === r.room_id ? "border-white/40 bg-white/[0.07]" : "border-line bg-white/[0.02] hover:border-white/25"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{r.name}</span>
                  <StatusChip status={r.status} />
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-mute">{r.headline}</div>
              </button>
            ))}
          </div>

          {/* selected room */}
          <RoomDetail report={report} sel={sel} technical={technical} chartData={chartData} cursor={player.t} onScrub={player.setT} preview={preview} setPreview={setPreview} busy={!!busy} fix={fix} />

          {/* reveal */}
          <div className="mt-4 border-t border-line pt-4">
            {reveal ? (
              <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`rounded-3xl border p-4 ${reveal.app_found_it ? "border-ok/60 bg-ok/10" : "border-hot/60 bg-hot/10"}`}>
                <div className="eyebrow">The hidden answer</div>
                <div className="mt-1 text-[17px] font-bold leading-snug">{reveal.summary}</div>
                {reveal.room_id && readings?.rooms[reveal.room_id] && reveal.fault_free_twin[reveal.room_id] && (
                  <div className="mt-3">
                    <LineChart
                      height={140}
                      data={[
                        { id: "m", label: "With the fault", color: "#ff6a3d", series: slice(readings.rooms[reveal.room_id].measured, ms(reveal.fault_free_twin[reveal.room_id].timestamps[0]), ms(reveal.fault_free_twin[reveal.room_id].timestamps.at(-1)!)) },
                        { id: "t", label: "Same night, no fault", color: "#2fd18b", series: reveal.fault_free_twin[reveal.room_id], dashed: true },
                      ]}
                    />
                  </div>
                )}
                <div className="mt-2 text-[11px] text-dim">Simulated ground truth, opened only now. Synthetic test, not field validation.</div>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary flex-1" onClick={() => start({ house: "hh09", random_fault: true, seed: Math.floor(Math.random() * 2 ** 31) }, "Hidden random fault")}>
                    <Dice5 size={15} /> Another house
                  </button>
                  <button className="btn btn-ghost" onClick={() => (setHome(null), setHealth(null), set({ view: "exterior", autoRotate: true, inset: 0, finding: null, focusRoom: null }))}>
                    <RotateCcw size={15} />
                  </button>
                </div>
              </motion.div>
            ) : (
              <button className="btn btn-ghost w-full" onClick={doReveal} disabled={!!busy || home.nights_monitored < 1}>
                <Eye size={15} /> Reveal what was hidden
              </button>
            )}
          </div>

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
          <EngineTrace className="pointer-events-auto max-w-[520px]" />
          <Timeline
            className="pointer-events-auto max-w-[640px]"
            {...player}
            onPlay={player.play}
            onPause={player.pause}
            onScrub={player.setT}
            caption={night ? `Night ${(nightIdx ?? nights.length - 1) + 1} · heating off · real winter 2020-21 weather · ${night.mean_outdoor_c.toFixed(1)}°C avg` : "No nights yet"}
          />
        </div>
      )}
    </div>
  );
}
