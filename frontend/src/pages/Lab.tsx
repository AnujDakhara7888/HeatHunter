import { AnimatePresence, motion } from "framer-motion";
import { Check, Dice5, Eye, FlaskConical, Gavel, Lock, Play, RotateCcw, Wind as WindIcon, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, traced } from "../api/client";
import type {
  Diagnosis,
  ExperimentResponse,
  GroundTruth,
  InsightResponse,
  MoneyResponse,
  NightObservations,
  RepairResult,
  ScenarioCreateRequest,
  Series,
} from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { EngineTrace } from "../components/EngineTrace";
import { Gauge } from "../components/Gauge";
import { LineChart, type ChartSeries } from "../components/LineChart";
import { Nav } from "../components/Nav";
import { Suspects } from "../components/Suspects";
import { Timeline } from "../components/Timeline";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { assumption, bicGap, causeLabel, fitsFor, strengthOf } from "../lib/diagnosis";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { CAUSE, ROOM_NAMES, SIM_TO_PLAN, ms, roomColor, type CauseKey } from "../lib/rooms";
import { useNight } from "../lib/useNight";
import { useScene } from "../store/scene";
import { useTrace } from "../store/trace";
import { HouseCanvas } from "../three/Scene";

type Phase = "start" | "night" | "diagnosed" | "tested" | "fixed" | "revealed";
const STEPS: { key: Phase; label: string }[] = [
  { key: "night", label: "Night" },
  { key: "diagnosed", label: "Diagnose" },
  { key: "tested", label: "Test" },
  { key: "fixed", label: "Fix" },
  { key: "revealed", label: "Reveal" },
];

const roomName = (sim: string | null | undefined) => (sim ? ROOM_NAMES[sim] ?? sim : "–");
const toPlan = (night: NightObservations): Record<string, Series> =>
  Object.fromEntries(Object.entries(night.room_temperature_series).map(([k, v]) => [SIM_TO_PLAN[k] ?? k, v]));

const fmtMoney = (usd: number) => `$${usd < 100 ? usd.toFixed(0) : Math.round(usd).toLocaleString()}`;

function nightChart(night: NightObservations, emphasise?: string | null): ChartSeries[] {
  const rooms = Object.entries(night.room_temperature_series).map(([id, s]) => ({
    id,
    label: ROOM_NAMES[id] ?? id,
    color: roomColor(id),
    series: s,
    width: emphasise === id ? 3 : 2,
    muted: emphasise != null && emphasise !== id,
  }));
  return [...rooms, { id: "out", label: "Outside", color: "#8a90a2", series: night.weather.outdoor_temperature, dashed: true, width: 1.5 }];
}

function StartCard({ onStart }: { onStart: (req: ScenarioCreateRequest, label: string) => void }) {
  const [judge, setJudge] = useState(false);
  const [room, setRoom] = useState("bedroom_1");
  const [fault, setFault] = useState<"draft" | "envelope_conduction" | "none">("draft");
  const [severity, setSeverity] = useState(2);
  const cards = [
    {
      icon: <Play size={18} />,
      title: "Guided night",
      line: "A hidden fault in one room. Follow the full investigation.",
      go: () => onStart({ mode: "guided", guided_scenario_id: "hh09-guided-insulation-v1" }, "Guided"),
    },
    {
      icon: <Dice5 size={18} />,
      title: "Surprise me",
      line: "New random fault, room and weather. A different answer every time.",
      go: () => onStart({ mode: "surprise", seed: Math.floor(Math.random() * 2 ** 31) }, "Surprise"),
    },
    {
      icon: <Gavel size={18} />,
      title: "Judge mode",
      line: "You hide the fault. We try to find it.",
      go: () => setJudge(true),
    },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24 }}
      className="glass pointer-events-auto mx-auto w-[min(760px,calc(100vw-32px))] rounded-[28px] p-6"
    >
      <div className="eyebrow">Fault Lab · digital twin of a real UK home</div>
      <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.03em]">
        One house. One hidden fault. <span className="text-mute">Can physics find it?</span>
      </h1>
      {!judge ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <button key={c.title} onClick={c.go} className="group rounded-2xl border border-line bg-white/[0.03] p-4 text-left transition hover:border-white/30 hover:bg-white/[0.06]">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-ink">{c.icon}</div>
              <div className="mt-3 font-semibold">{c.title}</div>
              <div className="mt-1 text-[13px] leading-snug text-mute">{c.line}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="text-sm text-mute">Pick it in secret. The engine never sees your choice; only the reveal does.</div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(SIM_TO_PLAN).map((id) => (
              <button key={id} onClick={() => setRoom(id)} className={`btn !py-1.5 ${room === id ? "btn-primary" : "btn-ghost"}`}>
                {ROOM_NAMES[id]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["draft", "envelope_conduction", "none"] as const).map((f) => (
              <button key={f} onClick={() => setFault(f)} className={`btn !py-1.5 ${fault === f ? "btn-primary" : "btn-ghost"}`}>
                {f === "none" ? "No fault" : CAUSE[f].label}
              </button>
            ))}
          </div>
          {fault !== "none" && (
            <label className="flex items-center gap-3 text-sm text-mute">
              Severity
              <input type="range" min={1.3} max={3} step={0.1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-48" />
              <span className="num text-ink">×{severity.toFixed(1)}</span>
            </label>
          )}
          <div className="flex gap-2">
            <button className="btn btn-hot" onClick={() => onStart({ mode: "judge", judge_fault_type: fault, judge_room_id: room, severity: fault === "none" ? 1 : severity }, "Judge")}>
              <Lock size={15} /> Hide it & start
            </button>
            <button className="btn btn-ghost" onClick={() => setJudge(false)}>Back</button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const idx = STEPS.findIndex((s) => s.key === phase);
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ${i === idx ? "bg-ink font-semibold text-black" : i < idx ? "text-ink" : "text-dim"}`}>
            {i < idx ? <Check size={12} /> : <span className="num">{i + 1}</span>}
            {s.label}
          </div>
          {i < STEPS.length - 1 && <div className={`h-px w-3 ${i < idx ? "bg-ink/60" : "bg-white/15"}`} />}
        </div>
      ))}
    </div>
  );
}

export default function Lab() {
  const set = useScene((s) => s.set);
  const [phase, setPhase] = useState<Phase>("start");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<{ id: string; label: string } | null>(null);
  const [passive, setPassive] = useState<NightObservations | null>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [fits1, setFits1] = useState<InsightResponse | null>(null);
  const [exp, setExp] = useState<ExperimentResponse | null>(null);
  const [fits2, setFits2] = useState<InsightResponse | null>(null);
  const [money, setMoney] = useState<MoneyResponse | null>(null);
  const [gas, setGas] = useState<number | null>(null);
  const [repairCost, setRepairCost] = useState<number | null>(null);
  const [effectiveness, setEffectiveness] = useState(1);
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  const [truth, setTruth] = useState<GroundTruth | null>(null);
  // "What would it look like if…": preview any explanation in 3D without changing the verdict.
  const [preview, setPreview] = useState<CauseKey | null>(null);
  useEffect(() => setPreview(null), [phase]);

  const final = exp?.updated_diagnosis ?? diag;
  const flagged = final?.flagged_room_id ?? null;
  const playingNight: NightObservations | null =
    phase === "fixed" && repair && showAfter ? repair.repaired_observations[0] : phase === "tested" && exp ? exp.observations : passive;
  const roomsPlan = useMemo(() => (playingNight ? toPlan(playingNight) : null), [playingNight]);
  const [windDirs, setWindDirs] = useState<Record<string, Series | null>>({});
  const weatherId = playingNight?.weather.night_id;
  useEffect(() => {
    if (!weatherId || weatherId in windDirs) return;
    // Measured direction is a companion series (not in the frozen WeatherNight contract).
    traced("wind", "GET /weather/{night}/wind-direction", () =>
      api.GET("/api/weather/{night_id}/wind-direction", { params: { path: { night_id: weatherId } } }),
      (s) => `${s.values.length} measured directions`,
    )
      .then((s) => setWindDirs((cur) => ({ ...cur, [weatherId]: s })))
      .catch(() => setWindDirs((cur) => ({ ...cur, [weatherId]: null })));
  }, [weatherId, windDirs]);
  const player = useNight(roomsPlan, playingNight?.weather.outdoor_temperature, playingNight?.weather.wind_speed, 12, weatherId ? windDirs[weatherId] : null);

  useEffect(() => {
    set({ plan: HH09_PLAN, view: "exterior", finding: null, focusRoom: null, fanOn: false, labels: true, autoRotate: true, names: {}, inset: 0, ir: false, zBearing: HH09_Z_BEARING, windFrom: null });
    useTrace.getState().clear();
  }, [set]);

  // Push the engine's finding into the 3D scene.
  useEffect(() => {
    const lead = final?.ranked_causes[0];
    if (!flagged || !lead || (final.status !== "confident" && final.status !== "ambiguous")) {
      set({ finding: null });
      return;
    }
    if (preview) {
      const fits = phase === "tested" ? flaggedFits2 : flaggedFits1;
      const m = fits[preview]?.fitted_multiplier ?? lead.fitted_multiplier;
      set({ finding: preview === "normal" ? null : { room: SIM_TO_PLAN[flagged], cause: preview, strength: strengthOf(m) } });
      return;
    }
    if (phase === "fixed" && showAfter && repair?.diagnosed_improvement.includes("no_fault")) {
      set({ finding: null });
      return;
    }
    set({ finding: { room: SIM_TO_PLAN[flagged], cause: lead.fault_type as "draft" | "envelope_conduction", strength: strengthOf(lead.fitted_multiplier) } });
  }, [final, flagged, phase, showAfter, repair, set, preview, fits1, fits2]);

  // What the assistant may know: only what is on screen.
  useEffect(() => {
    const lead = final?.ranked_causes[0];
    const est = money?.estimate;
    useChatContext.getState().setContext(
      {
        page: "Fault Lab (simulated HH09-inspired twin)",
        phase,
        flagged_room: flagged ? roomName(flagged) : null,
        flagged_room_id: flagged ? SIM_TO_PLAN[flagged] : null,
        status: final?.status,
        leading_cause: lead ? causeLabel(lead.fault_type) : null,
        runner_up: final?.ranked_causes[1] ? causeLabel(final.ranked_causes[1].fault_type) : null,
        bic_gap: bicGap(final),
        multiplier: lead?.fitted_multiplier,
        test: final?.test_decision?.explanation,
        evidence: final?.evidence.map((e) => e.statement),
        uncertainty: final?.uncertainty,
        annual_cost: est ? fmtMoney(est.annual_cost_estimate_usd) : null,
        annual_kwh: est?.annual_energy_estimate_kwh,
        payback_years: est?.simple_payback_years,
        repair_result: repair?.diagnosed_improvement,
        revealed_truth: truth ?? "not revealed yet",
      },
      phase === "start" || phase === "night"
        ? ["What am I looking at?", "Leak vs insulation?", "Why one cold night?"]
        : ["Why this room?", "How sure are you?", "Is it worth fixing?"],
    );
  }, [phase, final, flagged, money, repair, truth]);

  const run = async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label);
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

  const start = (req: ScenarioCreateRequest, label: string) =>
    run("Loading the night…", async () => {
      for (const reset of [setDiag, setFits1, setExp, setFits2, setMoney, setRepair, setTruth] as ((v: null) => void)[]) reset(null);
      const created = await traced("create", "POST /scenarios", () => api.POST("/api/scenarios", { body: req }), (d) => `${d.mode} · ${d.scenario_id.slice(0, 8)}`);
      const obs = await traced("obs", "GET /observations", () => api.GET("/api/scenarios/{id}/observations", { params: { path: { id: created.scenario_id } } }), (d) => `${Object.keys(d.nights[0].room_temperature_series).length} rooms · ${d.nights[0].weather.outdoor_temperature.values.length} readings`);
      setScenario({ id: created.scenario_id, label });
      setPassive(obs.nights[0]);
      setPhase("night");
      set({ view: "open", autoRotate: false, inset: 460 });
      setTimeout(() => player.play(), 900);
    });

  const analyze = () =>
    run("Fitting physics models…", async () => {
      const id = scenario!.id;
      const [d, f] = await Promise.all([
        traced("diagnose", "POST /diagnose", () => api.POST("/api/scenarios/{id}/diagnose", { params: { path: { id } }, body: {} }), (d) => `${d.status} · ${roomName(d.flagged_room_id)}`),
        traced("fits", "POST /insight/fits", () => api.POST("/api/insight/fits", { body: { nights: [passive!] } }), (r) => `${r.model_evaluations} model fits`),
      ]);
      setDiag(d);
      setFits1(f);
      setPhase("diagnosed");
      set({ view: "thermal", focusRoom: d.flagged_room_id ? SIM_TO_PLAN[d.flagged_room_id] : null });
      if (d.status === "confident") void priceIt(d.diagnosis_id);
    });

  const runTest = () =>
    run("Running the fan test…", async () => {
      const id = scenario!.id;
      set({ view: "fan", fanOn: true });
      const e = await traced("experiment", "POST /experiments", () =>
        api.POST("/api/scenarios/{id}/experiments", { params: { path: { id } }, body: { diagnosis_id: diag!.diagnosis_id, experiment_type: "exhaust_fan_depressurization" } }),
        (r) => `${r.updated_diagnosis.status} · ${causeLabel(r.updated_diagnosis.ranked_causes[0]?.fault_type ?? "")}`,
      );
      const f = await traced("fits", "POST /insight/fits", () => api.POST("/api/insight/fits", { body: { nights: [passive!, e.observations], room_ids: diag!.flagged_room_id ? [diag!.flagged_room_id] : undefined } }), (r) => `${r.model_evaluations} fits on both nights`);
      setExp(e);
      setFits2(f);
      setPhase("tested");
      setTimeout(() => player.play(), 600);
      if (e.updated_diagnosis.status === "confident") void priceIt(e.updated_diagnosis.diagnosis_id);
    });

  const priceIt = async (diagnosisId: string, overrides?: { gas?: number | null; repair?: number | null }) => {
    const m = await traced("money", "POST /money", () =>
      api.POST("/api/scenarios/{id}/money", {
        params: { path: { id: scenario!.id } },
        body: { diagnosis_id: diagnosisId, gas_price_pence_per_kwh: overrides?.gas ?? undefined, repair_cost_gbp: overrides?.repair ?? undefined },
      }),
      (r) => (r.estimate ? `${fmtMoney(r.estimate.annual_cost_estimate_usd)}/yr` : "no estimate"),
    ).catch(() => null);
    if (m) setMoney(m);
  };

  const applyFix = () =>
    run("Applying the fix and re-running the same night…", async () => {
      const r = await traced("repair", "POST /repair", () =>
        api.POST("/api/scenarios/{id}/repair", { params: { path: { id: scenario!.id } }, body: { diagnosis_id: final!.diagnosis_id, effectiveness } }),
        (d) => d.diagnosed_improvement.split(";")[0],
      );
      setRepair(r);
      setShowAfter(true);
      setPhase("fixed");
      set({ view: "open", fanOn: false });
      setTimeout(() => player.play(), 500);
    });

  const reveal = () =>
    run("Opening the envelope…", async () => {
      const t = await traced("reveal", "GET /reveal", () => api.GET("/api/scenarios/{id}/reveal", { params: { path: { id: scenario!.id } } }), (d) => (d.diagnosis_matched ? "matched" : "missed"));
      setTruth(t);
      setPhase("revealed");
    });

  const flaggedFits1 = fitsFor(fits1?.rooms.find((r) => r.room_id === flagged));
  const flaggedFits2 = fitsFor(fits2?.rooms.find((r) => r.room_id === flagged));
  const threshold = assumption(final, "threshold_ambiguity_bic");
  const detection = assumption(diag, "threshold_detection_bic");
  const testRecommended = diag?.test_decision?.recommended && !exp;
  const canFix = final?.status === "confident" && !repair;
  const fanNight = exp?.observations;
  const fanBand = fanNight?.protocol.fan_start && fanNight.protocol.fan_end ? { from: ms(fanNight.protocol.fan_start), to: ms(fanNight.protocol.fan_end), label: "FAN ON" } : null;

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <Nav transparent />
      <HouseCanvas className="absolute inset-0" />

      {phase !== "start" && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <ViewSwitcher views={["exterior", "thermal", "open", "inside", "fan"]} className="pointer-events-auto" />
        </div>
      )}
      <AnimatePresence>
        {preview && final && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 top-[166px] z-20 flex justify-center pr-[460px]"
          >
            <div className="glass pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[12.5px]">
              <span>
                Previewing <b style={{ color: CAUSE[preview].color }}>{CAUSE[preview].label.toLowerCase()}</b>
                <span className="text-mute">
                  {" · "}
                  {preview === final.ranked_causes[0]?.fault_type
                    ? "the engine's best explanation"
                    : preview === "normal"
                      ? "what a healthy room would look like"
                      : final.status === "confident"
                        ? "ruled out by the evidence"
                        : "still a contender"}
                </span>
              </span>
              <button onClick={() => setPreview(null)} className="rounded-full bg-ink px-3 py-1 font-semibold text-black">
                Back to verdict
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "start" && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-end gap-3 pb-[8vh]">
            {(busy || error) && (
              <div className={`glass rounded-full px-4 py-2 text-[13px] ${error ? "text-hot" : "text-mute"}`}>{error ?? busy}</div>
            )}
            <StartCard onStart={start} />
          </div>
        )}
      </AnimatePresence>

      {phase !== "start" && (
        <motion.aside
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass scroll-thin absolute bottom-4 right-4 top-16 z-30 flex w-[min(440px,calc(100vw-32px))] flex-col overflow-y-auto rounded-[26px] p-5"
        >
          <div className="flex items-center justify-between">
            <Stepper phase={phase} />
          </div>
          <div className="mt-1 text-[11px] text-dim">
            {scenario?.label} · scenario {scenario?.id.slice(0, 8)} · simulated twin, real HH09-region weather
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={phase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-4 flex-1">
              {phase === "night" && passive && (
                <section>
                  <h2 className="text-[26px] font-bold leading-tight tracking-tight">
                    Heating off. <span className="text-mute">Every room cools.</span>
                  </h2>
                  <p className="mt-1 text-[13px] text-mute">Four sensors, one night. A fault is hidden in one room, or none.</p>
                  <div className="mt-4">
                    <LineChart data={nightChart(passive)} cursor={player.t} onScrub={player.setT} height={210} />
                  </div>
                  <button className="btn btn-primary mt-5 w-full" onClick={analyze} disabled={!!busy}>
                    <FlaskConical size={16} /> Analyze the house
                  </button>
                </section>
              )}

              {phase === "diagnosed" && diag && passive && (
                <section className="space-y-4">
                  <div>
                    <div className="eyebrow">Verdict</div>
                    <h2 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">
                      {diag.flagged_room_id && (diag.status === "confident" || diag.status === "ambiguous") ? (
                        <>
                          The <span className="text-warm">{roomName(diag.flagged_room_id)}</span> is losing heat{" "}
                          <span className="text-warm">{diag.ranked_causes[0].fitted_multiplier.toFixed(1)}×</span> faster than it should.
                        </>
                      ) : (
                        "Nothing the model can confidently call a fault."
                      )}
                    </h2>
                  </div>
                  <Gauge status={diag.status} gap={bicGap(diag)} threshold={threshold} />
                  {fits1 && (
                    <div>
                      <div className="mb-1.5 flex justify-between text-[11px] text-mute">
                        <span>How unusual each room is</span>
                        <span className="num">{fits1.model_evaluations} fits · {Math.round(fits1.elapsed_ms)} ms</span>
                      </div>
                      <div className="space-y-1.5">
                        {[...fits1.rooms].sort((a, b) => b.anomaly_score - a.anomaly_score).map((r, i) => {
                          const max = Math.max(...fits1.rooms.map((x) => x.anomaly_score), detection ?? 1);
                          const over = detection != null && r.anomaly_score > detection;
                          return (
                            <button key={r.room_id} onClick={() => set({ focusRoom: SIM_TO_PLAN[r.room_id] })} className="flex w-full items-center gap-2 text-left text-[12px]">
                              <span className="w-20 text-mute">{roomName(r.room_id)}</span>
                              <div className="relative h-2 flex-1 rounded-full bg-white/[0.06]">
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: over ? "#ff6a3d" : roomColor(r.room_id) }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(2, (Math.max(0, r.anomaly_score) / max) * 100)}%` }}
                                  transition={{ delay: 0.1 * i, duration: 0.8 }}
                                />
                                {detection != null && <div className="absolute -top-1 h-4 w-px bg-white/50" style={{ left: `${(detection / max) * 100}%` }} />}
                              </div>
                              <span className={`w-14 text-right num ${over ? "text-hot" : "text-dim"}`}>{over ? "abnormal" : "normal"}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-1 text-[10.5px] text-dim">White tick = the engine's alarm threshold.</div>
                    </div>
                  )}
                  {diag.flagged_room_id && fits1 && (
                    <div>
                      <div className="mb-1.5 text-[11px] text-mute">Three suspects, each fitted to the {roomName(diag.flagged_room_id)} curve</div>
                      <Suspects
                        fits={flaggedFits1}
                        observed={passive.room_temperature_series[diag.flagged_room_id]}
                        nightId={passive.night_id}
                        leading={diag.ranked_causes[0]?.fault_type}
                        ruledOut={["normal"]}
                        selected={preview}
                        onSelect={(c) => setPreview((p) => (p === c ? null : c))}
                      />
                    </div>
                  )}
                  {testRecommended && (
                    <div className="rounded-2xl border border-[#2b3d60] bg-gradient-to-br from-[#16233b] to-transparent p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <WindIcon size={16} className="text-cool" /> One test would settle it
                      </div>
                      <p className="mt-1 text-[12.5px] text-mute">
                        Run an extract fan for 2 h on a calm night. A leak would cool faster; insulation would barely change.
                      </p>
                      <button className="btn btn-primary mt-3" onClick={runTest} disabled={!!busy}>
                        Run the fan test →
                      </button>
                    </div>
                  )}
                  {!testRecommended && diag.test_decision && !canFix && <p className="text-[12.5px] text-mute">{diag.test_decision.explanation}</p>}
                  {canFix && FixPanel()}
                  {!canFix && !testRecommended && (
                    <button className="btn btn-ghost w-full" onClick={reveal}>
                      <Eye size={15} /> Reveal what was hidden
                    </button>
                  )}
                </section>
              )}

              {phase === "tested" && exp && passive && (
                <section className="space-y-4">
                  <div>
                    <div className="eyebrow">After the fan test</div>
                    <h2 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">
                      {exp.updated_diagnosis.status === "confident" ? (
                        <>
                          It's <span style={{ color: CAUSE[exp.updated_diagnosis.ranked_causes[0].fault_type as keyof typeof CAUSE]?.color }}>{causeLabel(exp.updated_diagnosis.ranked_causes[0].fault_type).toLowerCase()}</span>, not {exp.updated_diagnosis.ranked_causes[1].fault_type === "draft" ? "an air leak" : "weak insulation"}.
                        </>
                      ) : (
                        "Still not sure. We won't guess."
                      )}
                    </h2>
                  </div>
                  <Gauge status={exp.updated_diagnosis.status} gap={bicGap(exp.updated_diagnosis)} threshold={assumption(exp.updated_diagnosis, "threshold_ambiguity_bic")} />
                  {flagged && fits2 && (
                    <div>
                      <div className="mb-1.5 text-[11px] text-mute">Fan night, {roomName(flagged)}: which story matches?</div>
                      <Suspects
                        fits={flaggedFits2}
                        observed={exp.observations.room_temperature_series[flagged]}
                        nightId={exp.observations.night_id}
                        leading={exp.updated_diagnosis.ranked_causes[0]?.fault_type}
                        ruledOut={exp.updated_diagnosis.status === "confident" ? ["normal", exp.updated_diagnosis.ranked_causes[1].fault_type] : ["normal"]}
                        band={fanBand}
                        selected={preview}
                        onSelect={(c) => setPreview((p) => (p === c ? null : c))}
                      />
                    </div>
                  )}
                  {canFix ? (
                    FixPanel()
                  ) : (
                    <button className="btn btn-ghost w-full" onClick={reveal}>
                      <Eye size={15} /> Reveal what was hidden
                    </button>
                  )}
                </section>
              )}

              {phase === "fixed" && repair && passive && flagged && (
                <section className="space-y-4">
                  <div>
                    <div className="eyebrow">Same night, after the fix</div>
                    <h2 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">
                      {repair.diagnosed_improvement.includes("no_fault") ? (
                        <>
                          Fixed. <span className="text-ok">The {roomName(flagged)} now cools normally.</span>
                        </>
                      ) : (
                        <>The fix helped less than expected.</>
                      )}
                    </h2>
                    <p className="mt-1 text-[12.5px] text-mute">{improvementLine(repair.diagnosed_improvement)}</p>
                  </div>
                  <div className="glass inline-flex rounded-full p-1 text-[12px]">
                    {[true, false].map((after) => (
                      <button key={String(after)} onClick={() => setShowAfter(after)} className={`rounded-full px-3 py-1 ${showAfter === after ? "bg-ink font-semibold text-black" : "text-mute"}`}>
                        {after ? "After" : "Before"}
                      </button>
                    ))}
                  </div>
                  <LineChart
                    height={190}
                    cursor={player.t}
                    onScrub={player.setT}
                    data={[
                      { id: "before", label: "Before fix", color: "#8a90a2", series: repair.original_observations[0].room_temperature_series[flagged], dashed: true },
                      { id: "after", label: "After fix", color: "#2fd18b", series: repair.repaired_observations[0].room_temperature_series[flagged], width: 2.5 },
                    ]}
                  />
                  {repair.remeasured_savings_kwh != null && (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Re-measured saving" value={`${Math.round(repair.remeasured_savings_kwh)} kWh/yr`} tone="ok" />
                      {repair.estimated_savings && <Stat label="Predicted" value={`${Math.round(repair.estimated_savings.annual_energy_estimate_kwh)} kWh/yr`} />}
                    </div>
                  )}
                  <button className="btn btn-hot w-full" onClick={reveal}>
                    <Eye size={15} /> Reveal what was hidden
                  </button>
                </section>
              )}

              {phase === "revealed" && truth && (
                <section className="space-y-4">
                  <div className="eyebrow">The answer</div>
                  <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`rounded-3xl border p-5 ${truth.diagnosis_matched ? "border-ok/60 bg-ok/10" : "border-hot/60 bg-hot/10"}`}>
                    <div className="text-[13px] text-mute">The simulator had planted</div>
                    <div className="mt-1 text-[26px] font-bold tracking-tight">
                      {truth.fault_type === "none" ? "No fault at all" : `${causeLabel(truth.fault_type)} in the ${roomName(truth.actual_room_id)}`}
                    </div>
                    {truth.fault_type !== "none" && <div className="text-[13px] text-mute num">severity ×{truth.severity.toFixed(1)}</div>}
                    <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
                      <Verdict ok={truth.diagnosis_matched} label="Diagnosis" />
                      <Verdict ok={truth.repair_addressed_cause} label="Repair" />
                    </div>
                  </motion.div>
                  <p className="text-[12px] text-dim">
                    The engine never saw this card. It is the simulator's private record, opened only now. Synthetic evaluation, not field validation.
                  </p>
                  <button className="btn btn-primary w-full" onClick={() => start({ mode: "surprise", seed: Math.floor(Math.random() * 2 ** 31) }, "Surprise")}>
                    <Dice5 size={15} /> Try another hidden fault
                  </button>
                  <button className="btn btn-ghost w-full" onClick={() => {
                      setPhase("start");
                      set({ view: "exterior", autoRotate: true, inset: 0, finding: null, focusRoom: null, fanOn: false });
                    }}>
                    <RotateCcw size={15} /> Start over
                  </button>
                </section>
              )}
            </motion.div>
          </AnimatePresence>

          {busy && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] text-mute">
              <span className="h-2 w-2 rounded-full bg-warm pulse-dot" /> {busy}
            </div>
          )}
          {error && <div className="mt-3 rounded-xl border border-hot/40 bg-hot/10 px3 px-3 py-2 text-[12px] text-hot">{error}</div>}
        </motion.aside>
      )}

      {phase !== "start" && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-[min(470px,calc(100vw-16px))] z-20 flex flex-col gap-2">
          <EngineTrace className="pointer-events-auto max-w-[520px]" />
          <Timeline
            className="pointer-events-auto max-w-[640px]"
            {...player}
            onPlay={player.play}
            onPause={player.pause}
            onScrub={player.setT}
            caption={phase === "tested" ? "Fan test night · extract fan on for the first two hours" : phase === "fixed" ? (showAfter ? "Same weather, after the fix" : "Original night") : "Passive night · heating off, doors closed"}
          />
        </div>
      )}
    </div>
  );

  function FixPanel() {
    const est = money?.estimate;
    const lead = final!.ranked_causes[0];
    const repairName = lead.fault_type === "draft" ? "Seal the drafts" : "Insulate the wall";
    const runner = final!.ranked_causes[1];
    const reprice = (g: number | null, r: number | null) => {
      setGas(g);
      setRepairCost(r);
      void priceIt(final!.diagnosis_id, { gas: g, repair: r });
    };
    const gasDefault = Number(est?.assumptions.find((a) => a.name === "gas_unit_price")?.value ?? 7.97);
    const fx = Number(est?.assumptions.find((a) => a.name === "gbp_to_usd")?.value ?? 1.34);
    return (
      <div className="space-y-3 rounded-2xl border border-line bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Wrench size={15} /> {repairName} in the {roomName(flagged)}
        </div>
        {est ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Lost / year" value={fmtMoney(est.annual_cost_estimate_usd)} sub={`${Math.round(est.annual_energy_estimate_kwh)} kWh`} tone="hot" />
              <Stat label="Repair" value={fmtMoney(est.repair_cost_usd)} sub="assumed" />
              <Stat label="Pays back" value={est.simple_payback_years ? `${est.simple_payback_years.toFixed(1)} yr` : "–"} tone="ok" />
            </div>
            <label className="block text-[11.5px] text-mute">
              Gas price <span className="num text-ink">{(gas ?? gasDefault).toFixed(1)}p/kWh</span>
              <input type="range" min={4} max={20} step={0.5} defaultValue={gas ?? gasDefault} onMouseUp={(e) => reprice(Number((e.target as HTMLInputElement).value), repairCost)} onTouchEnd={(e) => reprice(Number((e.target as HTMLInputElement).value), repairCost)} className="mt-1 w-full" />
            </label>
            <label className="block text-[11.5px] text-mute">
              Your repair quote <span className="num text-ink">£{Math.round(repairCost ?? est.repair_cost_usd / fx)}</span>
              <input type="range" min={0} max={2000} step={25} defaultValue={repairCost ?? Math.round(est.repair_cost_usd / fx)} onMouseUp={(e) => reprice(gas, Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => reprice(gas, Number((e.target as HTMLInputElement).value))} className="mt-1 w-full" />
            </label>
          </>
        ) : (
          <div className="text-[12px] text-mute pulse-dot">Pricing the extra heat loss…</div>
        )}
        <div className="space-y-1.5 text-[12px]">
          <Option label={repairName} note="recommended · verified below" tone="ok" active={preview === lead.fault_type} onClick={() => setPreview(lead.fault_type as CauseKey)} />
          {runner && (
            <Option
              label={runner.fault_type === "draft" ? "Seal drafts instead" : "Insulate instead"}
              note="the other suspect · ruled out by the evidence"
              active={preview === runner.fault_type}
              onClick={() => setPreview(runner.fault_type as CauseKey)}
            />
          )}
          <Option label="Do nothing" note={est ? `keep losing ~${fmtMoney(est.annual_cost_estimate_usd)}/yr` : "keep losing heat"} active={preview === null} onClick={() => setPreview(null)} />
        </div>
        <label className="block text-[11.5px] text-mute">
          Repair quality <span className="num text-ink">{Math.round(effectiveness * 100)}%</span>
          <input type="range" min={0.2} max={1} step={0.05} value={effectiveness} onChange={(e) => setEffectiveness(Number(e.target.value))} className="mt-1 w-full" />
        </label>
        <button className="btn btn-hot w-full" onClick={applyFix} disabled={!!busy}>
          Apply the fix & re-run the night
        </button>
        <div className="text-[10.5px] text-dim">Screening estimates from stated assumptions, not a quote or a certified audit.</div>
      </div>
    );
  }
}

function improvementLine(text: string) {
  const m = text.match(/([+-]?\d+\.\d+) degC/);
  const delta = m ? Number(m[1]) : null;
  return delta != null
    ? `On average ${Math.abs(delta).toFixed(1)}°C ${delta >= 0 ? "warmer" : "colder"} through the same night, same weather.`
    : text.split(";")[0];
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "hot" }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
      <div className="text-[10.5px] text-mute">{label}</div>
      <div className={`num text-[19px] font-bold tracking-tight ${tone === "ok" ? "text-ok" : tone === "hot" ? "text-hot" : ""}`}>{value}</div>
      {sub && <div className="num text-[10.5px] text-dim">{sub}</div>}
    </div>
  );
}

function Option({ label, note, tone, active, onClick }: { label: string; note: string; tone?: "ok"; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition hover:bg-white/[0.07] ${tone === "ok" ? "bg-ok/10 text-ink" : "bg-white/[0.03] text-mute"} ${active ? "ring-1 ring-white/50" : ""}`}
    >
      <span>{label}</span>
      <span className="text-[10.5px] text-dim">{note}</span>
    </button>
  );
}

function Verdict({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${ok ? "bg-ok/15 text-ok" : ok === false ? "bg-hot/15 text-hot" : "bg-white/5 text-mute"}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="font-semibold">{ok ? "✓ correct" : ok === false ? "✕ missed" : "n/a"}</div>
    </div>
  );
}
