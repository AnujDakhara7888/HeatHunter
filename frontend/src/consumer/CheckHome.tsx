import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Fan,
  Flame,
  Hammer,
  Home,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipForward,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
  XCircle,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Diagnosis, ScenarioCreateRequest } from "../lib/api";
import { numericAssumption } from "../lib/assumptions";
import { fmt, gbp, utcTime } from "../lib/format";
import { roomName, TWIN_ROOMS, type TwinRoomId } from "../lib/rooms";
import { useInvestigation, type InvestigationApi } from "../features/faultlab/useInvestigation";
import { useTwinState } from "../features/faultlab/useTwinState";
import { THERMAL_CSS, type CameraView, type Problem } from "./houseTypes";

const RealisticHouse = lazy(() => import("./RealisticHouse"));

type Stage = "loading" | "evening" | "recording" | "analysing" | "result" | "testing" | "fan" | "fixing" | "fixed";

const CAUSE = {
  draft: {
    name: "a draft",
    title: "Draft",
    how: "Cold outside air is sneaking in through gaps — around windows, doors, skirting boards or floorboards.",
    fix: "Seal the gaps",
    icon: Wind,
  },
  envelope_conduction: {
    name: "poor insulation",
    title: "Poor insulation",
    how: "Heat is soaking out through the walls, ceiling or floor faster than it should.",
    fix: "Add insulation",
    icon: Sparkles,
  },
} as const;

/* ------------------------------------------------------------------ UI bits */

function Button({ children, onClick, tone = "primary", busy, disabled }: { children: ReactNode; onClick: () => void; tone?: "primary" | "ghost"; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition disabled:opacity-50 ${
        tone === "primary"
          ? "bg-gradient-to-b from-orange-400 to-orange-600 text-white shadow-lg shadow-orange-900/30 hover:from-orange-300 hover:to-orange-500"
          : "border border-white/12 bg-white/[0.04] text-white hover:bg-white/10"
      }`}
    >
      {busy ? <Loader2 size={17} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

function Message({ icon, tone = "neutral", title, children }: { icon: ReactNode; tone?: "neutral" | "good" | "bad" | "warn"; title: ReactNode; children?: ReactNode }) {
  const ring = tone === "good" ? "bg-emerald-400/15 text-emerald-300" : tone === "bad" ? "bg-red-400/15 text-red-300" : tone === "warn" ? "bg-orange-400/15 text-orange-300" : "bg-white/10 text-white";
  return (
    <div className="animate-fade-up">
      <span className={`grid h-12 w-12 place-items-center rounded-2xl ${ring}`}>{icon}</span>
      <h2 className="mt-4 text-[24px] font-semibold leading-tight tracking-tight text-white">{title}</h2>
      {children && <div className="mt-2.5 space-y-2.5 text-[15px] leading-relaxed text-white/70">{children}</div>}
    </div>
  );
}

function Card({ children, tone }: { children: ReactNode; tone?: "orange" | "green" | "blue" }) {
  const c = tone === "orange" ? "border-orange-400/25 bg-orange-400/[0.06]" : tone === "green" ? "border-emerald-400/25 bg-emerald-400/[0.06]" : tone === "blue" ? "border-sky-400/25 bg-sky-400/[0.06]" : "border-white/10 bg-white/[0.03]";
  return <div className={`rounded-2xl border p-4 ${c}`}>{children}</div>;
}

const PROGRESS = ["Overnight test", "Find the problem", "Fix it", "The answer"];

function Progress({ step }: { step: number }) {
  return (
    <ol className="flex gap-1.5" aria-label="Progress">
      {PROGRESS.map((label, i) => (
        <li key={label} className="flex-1">
          <div className={`h-1.5 rounded-full ${i < step ? "bg-orange-400" : i === step ? "bg-orange-400/50" : "bg-white/10"}`} />
          <div className={`mt-1.5 text-[11.5px] ${i <= step ? "text-white/80" : "text-white/35"}`}>{label}</div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ money */

function Cost({ inv, diagnosis }: { inv: InvestigationApi; diagnosis: Diagnosis }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [quote, setQuote] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const base = diagnosis.money_estimate;
  const fx = numericAssumption(base?.assumptions, "gbp_to_usd");
  const m = inv.state.money;
  const est = m && m.diagnosis_id === diagnosis.diagnosis_id && (price !== null || quote !== null) ? m.estimate : base;
  if (!est || !fx) return null;
  const defPrice = numericAssumption(base?.assumptions, "gas_unit_price") ?? 8;
  const defQuote = base ? base.repair_cost_usd / fx : 0;
  const update = (p: number | null, q: number | null) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => inv.reprice(diagnosis.diagnosis_id, p, q), 220);
  };
  const cause = CAUSE[diagnosis.ranked_causes[0]?.fault_type as keyof typeof CAUSE];
  return (
    <Card tone="orange">
      <div className="text-[13px] text-orange-200/80">This could be costing you about</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-[38px] font-semibold leading-none text-white">{gbp(est.annual_cost_estimate_usd / fx)}</span>
        <span className="text-[15px] text-white/60">a year</span>
        {inv.state.busy === "money" && <Loader2 size={14} className="animate-spin text-white/50" />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-black/25 px-3 py-2.5">
          <div className="text-[12.5px] text-white/55">{cause?.fix ?? "The fix"} costs about</div>
          <div className="text-[19px] font-semibold text-white">{gbp(est.repair_cost_usd / fx)}</div>
        </div>
        <div className="rounded-xl bg-black/25 px-3 py-2.5">
          <div className="text-[12.5px] text-white/55">Pays for itself in</div>
          <div className="text-[19px] font-semibold text-white">{est.simple_payback_years != null ? `${fmt(est.simple_payback_years, 1)} years` : "—"}</div>
        </div>
      </div>
      <button className="mt-3 flex items-center gap-1 text-[13px] text-white/60 hover:text-white" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown size={15} className={`transition ${open ? "rotate-180" : ""}`} /> Use my own prices
      </button>
      {open && (
        <div className="mt-3 space-y-4 rounded-xl bg-black/25 p-3.5">
          <label className="block">
            <div className="mb-1.5 flex justify-between text-[13px] text-white/70">
              <span>My gas price</span>
              <span className="font-semibold text-white">{fmt(price ?? defPrice, 1)}p per kWh</span>
            </div>
            <input type="range" className="w-full accent-orange-400" min={2} max={25} step={0.1} value={price ?? defPrice} aria-label="My gas price" onChange={(e) => (setPrice(Number(e.target.value)), update(Number(e.target.value), quote))} />
          </label>
          <label className="block">
            <div className="mb-1.5 flex justify-between text-[13px] text-white/70">
              <span>Quote I've been given</span>
              <span className="font-semibold text-white">{gbp(quote ?? defQuote)}</span>
            </div>
            <input type="range" className="w-full accent-orange-400" min={0} max={Math.max(3000, Math.ceil(defQuote * 2))} step={25} value={quote ?? defQuote} aria-label="Quote I've been given" onChange={(e) => (setQuote(Number(e.target.value)), update(price, Number(e.target.value)))} />
          </label>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-snug text-white/45">A rough guide for a gas-heated home like this one in England, using today's price cap. Repair prices are typical quotes.</p>
    </Card>
  );
}

/* --------------------------------------------------------------- the page */

export function CheckHome({ request, onBack, onNew, onChallenge }: { request: ScenarioCreateRequest; onBack: () => void; onNew: (r: ScenarioCreateRequest) => void; onChallenge: () => void }) {
  const inv = useInvestigation();
  const twin = useTwinState(inv.state);
  const { state } = inv;
  const [stage, setStage] = useState<Stage>("loading");
  const [view, setView] = useState<CameraView>("outside");
  const [viewNonce, setViewNonce] = useState(0);
  const [heatView, setHeatView] = useState(true);
  const [effectiveness, setEffectiveness] = useState(1);
  const sawPlaying = useRef(false);
  const started = useRef(false);
  const fixStarted = useRef(false);

  const first = state.diagnoses[0];
  const latest = state.diagnoses[state.diagnoses.length - 1];
  const move = (v: CameraView) => {
    setView(v);
    setViewNonce((n) => n + 1);
  };
  const play = () => {
    sawPlaying.current = false;
    twin.setIndex(0);
    twin.setPlaying(true);
  };

  // Start the requested home once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    inv.start(request);
  }, [inv, request]);

  // Evening (heating on) → night (heating off, roof lifts) → playback.
  useEffect(() => {
    if (stage === "loading" && state.nights.length > 0) setStage("evening");
  }, [stage, state.nights.length]);
  useEffect(() => {
    if (stage !== "evening") return;
    const t = window.setTimeout(() => {
      setStage("recording");
      move("inside");
      play();
    }, 3200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // When a night finishes playing, move the story on.
  useEffect(() => {
    if (twin.playing) sawPlaying.current = true;
    if (twin.playing || !sawPlaying.current || twin.index < twin.length - 1) return;
    sawPlaying.current = false;
    if (stage === "recording") {
      setStage("analysing");
      inv.diagnose();
    } else if (stage === "fan") setStage("result");
    else if (stage === "fixing") setStage("fixed");
  }, [twin.playing, twin.index, twin.length, stage, inv]);

  useEffect(() => {
    if (stage === "analysing" && state.diagnoses.length > 0) setStage("result");
  }, [stage, state.diagnoses.length]);
  // Start each new night's playback in the same commit as the dataset switch, after
  // useTwinState has reset the scrubber for it (effects run in declaration order).
  useEffect(() => {
    if (stage === "testing" && twin.dataset?.night.kind === "fan_test" && !twin.dataset.repaired) {
      setStage("fan");
      play();
    }
    if (stage === "fixing" && state.repair && twin.dataset?.repaired && !fixStarted.current) {
      fixStarted.current = true;
      play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, twin.datasetKey, state.repair]);

  // Failed calls return the story to a stable point.
  useEffect(() => {
    if (!state.error) return;
    if (stage === "analysing" || stage === "testing") setStage(state.diagnoses.length ? "result" : "recording");
    if (stage === "fixing" && !state.repair) setStage("result");
  }, [state.error, stage, state.diagnoses.length, state.repair]);

  const thermal = useMemo<[number, number]>(() => {
    const values = twin.datasets.flatMap((d) => Object.values(d.night.room_temperature_series).flatMap((s) => s.values.filter((v): v is number => v != null)));
    if (!values.length) return [10, 21];
    return [Math.floor(Math.min(...values)), Math.ceil(Math.max(...values))];
  }, [twin.datasets]);

  const repairText = state.repair?.diagnosed_improvement ?? "";
  const cleared = /status: no_fault/.test(repairText);
  const delta = Number(repairText.match(/change ([+-]?[\d.]+) degC/)?.[1] ?? NaN);
  const showProblem = ["result", "testing", "fan", "fixing", "fixed"].includes(stage) && latest && (latest.status === "ambiguous" || latest.status === "confident");
  const shownDiagnosis = stage === "fan" || stage === "testing" ? first : latest;
  let problemRoom: TwinRoomId | null = null;
  let problem: Problem = null;
  if (showProblem && shownDiagnosis && (shownDiagnosis.status === "ambiguous" || shownDiagnosis.status === "confident")) {
    problemRoom = shownDiagnosis.flagged_room_id as TwinRoomId;
    problem = shownDiagnosis.status === "confident" ? (shownDiagnosis.ranked_causes[0].fault_type as Problem) : "unsure";
    if (state.repair && cleared && twin.dataset?.repaired) problemRoom = null;
  }
  const fixedRoom = state.repair && cleared && twin.dataset?.repaired ? (latest?.flagged_room_id as TwinRoomId) : null;
  const roofOpen = view === "inside";
  const night = twin.night;
  const fanWindow = night?.protocol.fan_on && night.protocol.fan_start && night.protocol.fan_end ? `${utcTime(night.protocol.fan_start)}–${utcTime(night.protocol.fan_end)}` : null;

  const progressStep = state.truth ? 4 : stage === "fixed" || stage === "fixing" ? 3 : ["result", "testing", "fan"].includes(stage) ? (latest?.status === "confident" ? 2 : 1) : stage === "analysing" ? 1 : 0;

  // Caption over the house.
  const caption =
    stage === "loading"
      ? { icon: <Loader2 size={15} className="animate-spin" />, text: "Setting up the home…" }
      : stage === "evening"
        ? { icon: <Sun size={15} />, text: "Evening — the heating has kept the house warm" }
        : stage === "recording"
          ? { icon: <Moon size={15} />, text: "Night — heating off. Watching how fast each room cools…" }
          : stage === "analysing"
            ? { icon: <Search size={15} />, text: "Working out which room is losing heat…" }
            : stage === "fan" || stage === "testing"
              ? { icon: <Fan size={15} />, text: `Fan test night${fanWindow ? ` — extractor fan on ${fanWindow}` : ""}` }
              : stage === "fixing"
                ? { icon: <Hammer size={15} />, text: "The same cold night, after the fix…" }
                : { icon: <Moon size={15} />, text: twin.dataset?.repaired ? "After the fix" : twin.dataset?.night.kind === "fan_test" ? "Fan test night" : "The overnight test" };

  /* ---------------------------------------------------------- assistant */
  let panel: ReactNode;
  const busy = state.busy;
  const revealBtn = (
    <Button tone="ghost" onClick={inv.reveal} busy={busy === "reveal"}>
      <Eye size={17} /> Show me the hidden answer
    </Button>
  );

  if (stage === "loading" || stage === "evening" || stage === "recording" || stage === "analysing") {
    panel = (
      <div className="space-y-5">
        <Message
          icon={stage === "analysing" ? <Search size={22} /> : stage === "recording" ? <Moon size={22} /> : <Flame size={22} />}
          title={stage === "analysing" ? "Finding the problem…" : stage === "recording" ? "Running the overnight test" : "Getting the house ready"}
        >
          {stage === "analysing" ? (
            <p>HeatHunter is comparing how each room cooled against how a healthy version of this home would cool.</p>
          ) : (
            <p>
              We switch the heating off for the night and record the temperature in every room every five minutes. Rooms that lose heat
              faster than they should stand out.
            </p>
          )}
        </Message>
        {stage === "recording" && (
          <Button tone="ghost" onClick={() => (twin.setPlaying(false), twin.setIndex(twin.length - 1))}>
            <SkipForward size={17} /> Skip to the results
          </Button>
        )}
        {stage === "analysing" && (
          <div className="flex items-center gap-2 text-[14px] text-white/60">
            <Loader2 size={16} className="animate-spin" /> Analysing…
          </div>
        )}
      </div>
    );
  } else if (state.truth) {
    const t = state.truth;
    const cause = CAUSE[t.fault_type as keyof typeof CAUSE];
    panel = (
      <div className="space-y-5">
        <Message icon={t.diagnosis_matched ? <CheckCircle2 size={24} /> : <XCircle size={24} />} tone={t.diagnosis_matched ? "good" : "warn"} title={t.diagnosis_matched ? "HeatHunter got it right!" : "Not quite this time"}>
          <p>
            {t.fault_type === "none" ? (
              <>This home had <b className="text-white">no hidden problem</b>.</>
            ) : (
              <>
                The hidden problem was <b className="text-white">{cause?.name}</b> in the <b className="text-white">{roomName(t.actual_room_id)}</b>.
              </>
            )}
          </p>
          {t.repair_addressed_cause !== null && <p>{t.repair_addressed_cause ? "And the fix tackled the real cause." : "The fix aimed at a different cause, which is why it couldn't help."}</p>}
          {!t.diagnosis_matched && <p className="text-white/55">Drafts and poor insulation can look almost the same from temperatures alone. HeatHunter would rather say "not sure" than send you the wrong fix.</p>}
        </Message>
        <div className="space-y-2.5">
          <Button onClick={onChallenge}>
            <EyeOff size={17} /> Hide a problem for HeatHunter
          </Button>
          <Button tone="ghost" onClick={onBack}>
            <Home size={16} /> Choose a home
          </Button>
        </div>
      </div>
    );
  } else if (stage === "fixing") {
    panel = (
      <Message icon={<Hammer size={22} />} title="Fixing and re-testing…">
        <p>We apply the fix, then run exactly the same cold night again to see what changed.</p>
      </Message>
    );
  } else if (stage === "fixed" && state.repair) {
    const room = roomName(latest?.flagged_room_id);
    panel = (
      <div className="space-y-5">
        <Message icon={cleared ? <CheckCircle2 size={24} /> : <XCircle size={24} />} tone={cleared ? "good" : "warn"} title={cleared ? `Fixed! The ${room} holds its heat` : `The fix didn't help the ${room}`}>
          {cleared ? (
            <p>
              On the same cold night, the {room} stayed <b className="text-white">{Number.isFinite(delta) ? `${fmt(delta, 1)}°C warmer` : "warmer"}</b> on
              average, and it no longer stands out from the other rooms.
            </p>
          ) : (
            <p>On the same night the {room} cooled just as fast as before. The real cause may be something else.</p>
          )}
          {state.repair.remeasured_savings_kwh != null && state.repair.remeasured_savings_kwh > 0 && (
            <p>
              That's roughly <b className="text-white">{fmt(state.repair.remeasured_savings_kwh, 0)} kWh</b> of gas saved a year.
            </p>
          )}
        </Message>
        <Button onClick={inv.reveal} busy={busy === "reveal"}>
          <Eye size={17} /> Show me the hidden answer
        </Button>
      </div>
    );
  } else if (latest && stage !== "fan" && stage !== "testing") {
    const room = roomName(latest.flagged_room_id);
    if (latest.status === "no_fault") {
      panel = (
        <div className="space-y-5">
          <Message icon={<CheckCircle2 size={24} />} tone="good" title="Good news — nothing unusual">
            <p>Every room cooled the way a healthy version of this home would. Nothing is losing heat abnormally fast.</p>
          </Message>
          {revealBtn}
        </div>
      );
    } else if (latest.status === "unexplained") {
      panel = (
        <div className="space-y-5">
          <Message icon={<Search size={22} />} tone="warn" title="Something's not right, but we can't pin it down">
            <p>These temperatures don't match any of the problems HeatHunter knows about. Rather than guess, it tells you it isn't sure.</p>
          </Message>
          {revealBtn}
        </div>
      );
    } else if (latest.status === "ambiguous") {
      const canTest = !state.experimentRun && first?.test_decision?.recommended;
      panel = (
        <div className="space-y-5">
          <Message icon={<Thermometer size={22} />} tone="bad" title={<>The <span className="text-red-300">{room}</span> is losing heat too fast</>}>
            <p>It cools faster than it should. There are two likely reasons — and on a normal night they look almost the same:</p>
          </Message>
          <div className="grid gap-2.5">
            {latest.ranked_causes.map((fit) => {
              const c = CAUSE[fit.fault_type as keyof typeof CAUSE];
              if (!c) return null;
              const Icon = c.icon;
              return (
                <Card key={fit.fault_type}>
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
                    <Icon size={17} className={fit.fault_type === "draft" ? "text-sky-300" : "text-orange-300"} /> {c.title}?
                  </div>
                  <p className="mt-1 text-[13.5px] leading-snug text-white/60">{c.how}</p>
                </Card>
              );
            })}
          </div>
          {canTest ? (
            <Card tone="blue">
              <div className="flex items-start gap-3">
                <Fan size={22} className="mt-0.5 shrink-0 text-sky-300" />
                <div>
                  <div className="text-[15.5px] font-semibold text-white">One quick test can tell which</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-white/65">
                    We run an extractor fan on another cold night. It pulls outside air in through any gaps, so a draughty room cools much faster —
                    a badly insulated one barely changes.
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Button onClick={() => (setStage("testing"), inv.runExperiment(first!.diagnosis_id))} busy={busy === "experiment"}>
                  <Fan size={17} /> Run the fan test
                </Button>
              </div>
              <p className="mt-2.5 text-[12px] leading-snug text-white/45">Safety: in a real home, running fans can pull fumes back down from some gas or wood burners. This test is only a simulation.</p>
            </Card>
          ) : (
            <Card>
              <p className="text-[14px] leading-relaxed text-white/70">
                {state.experimentRun
                  ? "Even after the fan test, the two causes are too close to call. HeatHunter won't guess — so it won't recommend a fix it can't justify."
                  : "A fan test wouldn't help here — both causes would react the same way. HeatHunter won't guess."}
              </p>
            </Card>
          )}
          {!canTest && revealBtn}
        </div>
      );
    } else {
      const c = CAUSE[latest.ranked_causes[0].fault_type as keyof typeof CAUSE];
      panel = (
        <div className="space-y-5">
          <Message icon={<c.icon size={22} />} tone="bad" title={<>Found it: <span className="text-red-300">{c.name}</span> in the {room}</>}>
            <p>
              {state.experimentRun ? "The fan test settled it. " : ""}
              {c.how}
            </p>
          </Message>
          <Cost inv={inv} diagnosis={latest} />
          <Card>
            <div className="text-[15.5px] font-semibold text-white">Try the fix: {c.fix.toLowerCase()}</div>
            <label className="mt-3 block">
              <div className="mb-1.5 flex justify-between text-[13px] text-white/65">
                <span>How good a job?</span>
                <span className="font-semibold text-white">{effectiveness >= 0.95 ? "Thorough" : effectiveness >= 0.6 ? "Decent" : effectiveness > 0.2 ? "Patchy" : "Barely"}</span>
              </div>
              <input type="range" className="w-full accent-orange-400" min={0} max={1} step={0.05} value={effectiveness} aria-label="How good a job" onChange={(e) => setEffectiveness(Number(e.target.value))} />
            </label>
            <div className="mt-4">
              <Button onClick={() => (setStage("fixing"), inv.repair(latest.diagnosis_id, effectiveness))} busy={busy === "repair"}>
                <Hammer size={17} /> {c.fix}
              </Button>
            </div>
          </Card>
        </div>
      );
    }
  } else {
    panel = (
      <Message icon={<Fan size={22} />} title="Running the fan test…">
        <p>Watch the {roomName(first?.flagged_room_id)}: if it's a draft, it should cool noticeably faster while the fan is on.</p>
      </Message>
    );
  }

  const selected = twin.selected;
  const sel = selected ? twin.readings[selected] : undefined;

  return (
    <div className="grid min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,1fr)_440px]">
      <div className="relative min-h-[60vh] lg:h-[calc(100vh-64px)]">
        <Suspense fallback={<div className="grid h-full place-items-center text-white/60"><Loader2 className="animate-spin" /></div>}>
          <RealisticHouse
            phase={stage === "loading" || stage === "evening" ? "heating" : "night"}
            roofOpen={roofOpen}
            heatView={heatView && roofOpen}
            readings={twin.readings}
            thermal={thermal}
            showLabels={roofOpen && stage !== "loading" && stage !== "evening"}
            problemRoom={problemRoom}
            problem={problem}
            fixedRoom={fixedRoom}
            truthRoom={(state.truth?.actual_room_id as TwinRoomId) ?? null}
            fanOn={twin.fanOnNow}
            selected={selected}
            onSelect={(id) => twin.setSelected((s) => (s === id ? null : id))}
            autoRotate={stage === "loading" || stage === "evening"}
            view={view}
            viewNonce={viewNonce}
            height="100%"
          />
        </Suspense>

        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 py-2 text-[13.5px] text-white backdrop-blur-md">
            {caption.icon} {caption.text}
            {night && !(stage === "loading" || stage === "evening") && <span className="ml-1 font-semibold">· {twin.cursorIso ? utcTime(twin.cursorIso) : ""}</span>}
          </div>
          <button className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-3.5 py-2 text-[13px] text-white/80 backdrop-blur-md hover:text-white" onClick={onBack}>
            <ArrowLeft size={15} /> Choose another home
          </button>
        </div>

        {sel && selected && roofOpen && (
          <div className="absolute left-4 top-16 rounded-2xl border border-white/15 bg-black/55 px-4 py-3 text-[13.5px] text-white backdrop-blur-md">
            <div className="font-semibold">{TWIN_ROOMS[selected].name}</div>
            <div className="text-white/70">
              {fmt(sel.temp)}°C now{sel.drop != null ? ` · cooled ${fmt(sel.drop, 1)}° tonight` : ""}
            </div>
          </div>
        )}

        {night && !(stage === "loading" || stage === "evening") && (
          <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/12 bg-black/50 px-3 py-2.5 backdrop-blur-md">
            <button
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-40"
              disabled={["recording", "fan", "fixing", "analysing"].includes(stage)}
              onClick={() => {
                if (twin.index >= twin.length - 1) twin.setIndex(0);
                twin.setPlaying((p) => !p);
              }}
              aria-label={twin.playing ? "Pause" : "Replay the night"}
            >
              {twin.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <input
              type="range"
              className="min-w-0 flex-1 basis-32 accent-orange-400"
              min={0}
              max={Math.max(0, twin.length - 1)}
              value={twin.index}
              disabled={["recording", "fan", "fixing", "analysing"].includes(stage)}
              onChange={(e) => (twin.setPlaying(false), twin.setIndex(Number(e.target.value)))}
              aria-label="Time of night"
            />
            {roofOpen && (
              <div className="hidden items-center gap-2 text-[12px] text-white/70 md:flex">
                <span>{thermal[0]}°</span>
                <span className="h-2.5 w-24 rounded-full" style={{ background: THERMAL_CSS }} />
                <span>{thermal[1]}°</span>
              </div>
            )}
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              <button className={`rounded-full px-3 py-1 text-[12.5px] ${view === "outside" ? "bg-white text-black" : "text-white/75"}`} onClick={() => move("outside")}>
                Outside
              </button>
              <button className={`rounded-full px-3 py-1 text-[12.5px] ${view === "inside" ? "bg-white text-black" : "text-white/75"}`} onClick={() => move("inside")}>
                Inside
              </button>
            </div>
            {roofOpen && (
              <button className={`rounded-full px-3 py-1.5 text-[12.5px] ${heatView ? "bg-orange-500 text-white" : "bg-white/10 text-white/75"}`} onClick={() => setHeatView((h) => !h)} aria-pressed={heatView}>
                <Thermometer size={13} className="mr-1 inline" />
                Heat view
              </button>
            )}
            {twin.datasets.length > 1 && !["fan", "fixing", "testing"].includes(stage) && (
              <select className="rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[12.5px] text-white" value={twin.datasetKey} onChange={(e) => twin.setDatasetKey(e.target.value)} aria-label="Which night">
                {twin.datasets.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.repaired ? `After the fix${d.night.kind === "fan_test" ? " (fan night)" : ""}` : d.night.kind === "fan_test" ? "Fan test night" : "First night"}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <aside className="border-l border-white/8 bg-[#10151c] lg:h-[calc(100vh-64px)] lg:overflow-y-auto">
        <div className="space-y-6 p-6 sm:p-7">
          <Progress step={progressStep} />
          {state.error && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-[14px] text-red-100">
              <XCircle size={17} className="mt-0.5 shrink-0" />
              <div className="flex-1">Something went wrong talking to HeatHunter. Please try again.</div>
              <button className="text-[13px] underline" onClick={inv.dismissError}>
                OK
              </button>
            </div>
          )}
          {panel}
          {state.scenarioId && !state.truth && (
            <button className="flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white/80" onClick={() => onNew(request)}>
              <RotateCcw size={13} /> Start this check again
            </button>
          )}
          <p className="text-[12px] leading-relaxed text-white/35">
            This is an example home modelled on a real bungalow in England. The problem in it was planted for the demo.
            {request.mode === "guided" ? " This walkthrough was picked because it shows every step — results on other homes vary." : ""}
          </p>
        </div>
      </aside>
    </div>
  );
}
