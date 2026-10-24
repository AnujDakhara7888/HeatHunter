import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Dices,
  EyeOff,
  Fan,
  Hammer,
  Info,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Activity,
  Wind,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GUIDED_FULL_ID } from "../../lib/demo";
import type { Diagnosis, HypothesisFit } from "../../lib/api";
import { numericAssumption } from "../../lib/assumptions";
import { fmt, gbp, utcTime } from "../../lib/format";
import { roomName, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";
import { TelemetryChart } from "../../components/TelemetryChart";
import { ErrorNote, Slider, Spinner } from "../../components/ui";
import { JudgeDialog } from "./ScenarioControls";
import { TwinView } from "./TwinView";
import type { InvestigationApi } from "./useInvestigation";
import { firstValue, mean, type TwinState } from "./useTwinState";

const GUIDED = { mode: "guided", guided_scenario_id: GUIDED_FULL_ID } as const;

const CAUSE_PLAIN: Record<string, { name: string; short: string; how: string; fix: string; icon: typeof Wind }> = {
  draft: {
    name: "a draft",
    short: "Draft (air leak)",
    how: "Cold outside air sneaking in through gaps around windows, doors or floors.",
    fix: "Seal the leaks",
    icon: Wind,
  },
  envelope_conduction: {
    name: "poor insulation",
    short: "Poor insulation",
    how: "Heat soaking out through the walls, ceiling or floor faster than it should.",
    fix: "Add insulation",
    icon: Sparkles,
  },
};

function plainCause(fit: HypothesisFit | undefined) {
  return fit ? CAUSE_PLAIN[fit.fault_type] : undefined;
}

/* ----------------------------------------------------------------- pieces */

function BigButton({ children, onClick, busy, busyText, tone = "primary", disabled }: {
  children: ReactNode;
  onClick: () => void;
  busy?: boolean;
  busyText?: string;
  tone?: "primary" | "plain" | "warm";
  disabled?: boolean;
}) {
  const style =
    tone === "primary"
      ? "bg-gradient-to-b from-[#1aa6c4] to-[#0e7d96] text-white shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] hover:from-[#22b8d8] hover:to-[#1290ab]"
      : tone === "warm"
        ? "bg-gradient-to-b from-[#f0a43a] to-[#d1801a] text-[#1d1204] shadow-[0_8px_30px_-10px_rgba(242,165,22,0.6)] hover:from-[#f6b24d]"
        : "border border-white/12 bg-white/5 text-ink hover:bg-white/10";
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {busy ? (
        <>
          <Spinner size={16} /> {busyText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function Bubble({ emoji, title, children }: { emoji: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="animate-fade-up">
      <div className="mb-2 text-[34px] leading-none" aria-hidden>
        {emoji}
      </div>
      <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-white">{title}</h2>
      {children && <div className="mt-2 space-y-2 text-[14.5px] leading-relaxed text-ink-2">{children}</div>}
    </div>
  );
}

function SoftCard({ children, tone }: { children: ReactNode; tone?: "warn" | "ok" | "accent" | "crit" }) {
  const border =
    tone === "warn"
      ? "border-warn/30 bg-warn/[0.06]"
      : tone === "ok"
        ? "border-ok/30 bg-ok/[0.07]"
        : tone === "crit"
          ? "border-crit/30 bg-crit/[0.06]"
          : tone === "accent"
            ? "border-accent/30 bg-accent/[0.06]"
            : "border-white/8 bg-white/[0.03]";
  return <div className={`rounded-2xl border p-4 ${border}`}>{children}</div>;
}

const STEPS = [
  { key: "measure", label: "Measure", icon: Moon },
  { key: "find", label: "Find", icon: Search },
  { key: "test", label: "Test", icon: Fan },
  { key: "fix", label: "Fix", icon: Hammer },
  { key: "reveal", label: "Reveal", icon: EyeOff },
] as const;

function Stepper({ inv }: { inv: InvestigationApi }) {
  const s = inv.state;
  const first = s.diagnoses[0];
  const latest = s.diagnoses[s.diagnoses.length - 1];
  const done = {
    measure: s.nights.length > 0,
    find: !!first,
    test: s.experimentRun,
    fix: !!s.repair,
    reveal: !!s.truth,
  };
  const skipped = {
    test: !!first && !s.experimentRun && (!first.test_decision?.recommended || !!s.truth),
    fix: !!first && !s.repair && (latest?.status !== "confident" || !!s.truth),
  } as Record<string, boolean>;
  const currentIndex = STEPS.findIndex((st) => !done[st.key] && !skipped[st.key]);
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2" aria-label="Progress">
      {STEPS.map((st, i) => {
        const Icon = st.icon;
        const isDone = done[st.key];
        const isSkip = skipped[st.key];
        const isNow = i === currentIndex && !!s.scenarioId;
        return (
          <li key={st.key} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2 py-2 sm:px-3 ${
                isDone
                  ? "border-accent/40 bg-accent/10 text-ink"
                  : isNow
                    ? "border-warn/50 bg-warn/10 text-white"
                    : "border-white/8 text-ink-4"
              }`}
              aria-current={isNow ? "step" : undefined}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${isDone ? "bg-accent/25 text-accent" : isNow ? "bg-warn/25 text-warn" : "bg-white/5"}`}>
                {isDone ? <CheckCircle2 size={14} /> : <Icon size={13} />}
              </span>
              <span className={`hidden truncate text-[12.5px] font-medium sm:inline ${isSkip ? "line-through opacity-60" : ""}`}>{st.label}</span>
            </div>
            {i < STEPS.length - 1 && <ArrowRight size={12} className="hidden shrink-0 text-ink-4 md:block" />}
          </li>
        );
      })}
    </ol>
  );
}

function CauseCards({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {diagnosis.ranked_causes.map((fit, i) => {
        const c = CAUSE_PLAIN[fit.fault_type];
        if (!c) return null;
        const Icon = c.icon;
        return (
          <div key={fit.fault_type} className={`rounded-2xl border p-3.5 ${i === 0 ? "border-warn/40 bg-warn/[0.07]" : "border-white/8 bg-white/[0.03]"}`}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <Icon size={16} className={i === 0 ? "text-warn" : "text-ink-3"} /> {c.short}
              </span>
              {i === 0 && <span className="rounded-full bg-warn/20 px-2 py-0.5 text-[10.5px] font-semibold text-warn">slightly closer fit</span>}
            </div>
            <p className="text-[12.5px] leading-snug text-ink-3">{c.how}</p>
          </div>
        );
      })}
    </div>
  );
}

function Money({ inv, diagnosis }: { inv: InvestigationApi; diagnosis: Diagnosis }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [repairCost, setRepairCost] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const base = diagnosis.money_estimate;
  const fx = numericAssumption(base?.assumptions, "gbp_to_usd");
  const money = inv.state.money;
  const estimate = money && money.diagnosis_id === diagnosis.diagnosis_id && (price !== null || repairCost !== null) ? money.estimate : base;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!estimate || !fx) return null;
  const defaultPrice = numericAssumption(base?.assumptions, "gas_unit_price");
  const defaultRepair = base ? base.repair_cost_usd / fx : 0;
  const schedule = (p: number | null, r: number | null) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => inv.reprice(diagnosis.diagnosis_id, p, r), 220);
  };
  const cause = plainCause(diagnosis.ranked_causes[0]);
  return (
    <SoftCard tone="warn">
      <div className="text-[12px] font-medium uppercase tracking-wider text-warn/90">What it may be costing</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="num text-[34px] font-semibold leading-none text-white">{gbp(estimate.annual_cost_estimate_usd / fx)}</span>
        <span className="text-[14px] text-ink-2">a year in extra gas</span>
        {inv.state.busy === "money" && <Spinner size={13} />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-ink-3">{cause?.fix ?? "Repair"} costs about</div>
          <div className="num text-[17px] font-semibold text-white">{gbp(estimate.repair_cost_usd / fx)}</div>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-ink-3">Pays for itself in</div>
          <div className="num text-[17px] font-semibold text-white">
            {estimate.simple_payback_years != null ? `${fmt(estimate.simple_payback_years, 1)} years` : "—"}
          </div>
        </div>
      </div>
      <button className="mt-3 flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-white" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} /> Use my own prices
      </button>
      {open && (
        <div className="mt-3 space-y-4 rounded-xl bg-black/20 p-3">
          <Slider
            label="My gas price"
            value={price ?? defaultPrice ?? 8}
            min={2}
            max={25}
            step={0.1}
            display={`${fmt(price ?? defaultPrice, 1)}p per kWh`}
            onChange={(v) => {
              setPrice(v);
              schedule(v, repairCost);
            }}
          />
          <Slider
            label="Quote for the repair"
            value={repairCost ?? defaultRepair}
            min={0}
            max={Math.max(3000, Math.ceil(defaultRepair * 2))}
            step={25}
            display={gbp(repairCost ?? defaultRepair)}
            onChange={(v) => {
              setRepairCost(v);
              schedule(price, v);
            }}
          />
        </div>
      )}
      <p className="mt-3 text-[11.5px] leading-snug text-ink-3">
        A rough estimate for a home like this one in England (gas boiler, Ofgem price cap). Repair prices are typical quotes, not verified.
        ≈ {`$${fmt(estimate.annual_cost_estimate_usd, 0)}`} a year.
      </p>
    </SoftCard>
  );
}

/* ----------------------------------------------------------- assistant */

function Assistant({ inv, openJudge }: { inv: InvestigationApi; openJudge: () => void }) {
  const { state } = inv;
  const busy = state.busy;
  const first = state.diagnoses[0];
  const latest = state.diagnoses[state.diagnoses.length - 1];
  const [effectiveness, setEffectiveness] = useState(1);

  useEffect(() => setEffectiveness(1), [state.scenarioId]);

  // 0 — welcome
  if (!state.scenarioId) {
    return (
      <div className="space-y-5">
        <Bubble emoji="👋" title="Let's find where this home is losing heat">
          <p>
            HeatHunter works like a <b className="text-white">check-engine light for a house</b>. We record how fast each room cools on a cold
            night, then work out which room is leaking heat — and why.
          </p>
        </Bubble>
        <div className="space-y-2.5">
          <BigButton onClick={() => inv.start(GUIDED)} busy={busy === "create"} busyText="Setting up the house…">
            <Play size={17} /> Show me how it works
          </BigButton>
          <div className="grid grid-cols-2 gap-2.5">
            <BigButton tone="plain" onClick={openJudge} disabled={!!busy}>
              <EyeOff size={16} /> Hide a problem
            </BigButton>
            <BigButton tone="plain" onClick={() => inv.start({ mode: "surprise" })} disabled={!!busy}>
              <Dices size={16} /> Surprise me
            </BigButton>
          </div>
        </div>
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
          <Info size={14} className="mt-0.5 shrink-0" />
          This is a simulated home modelled on a real English bungalow (SMETER HH09). Any problem in it was planted on purpose — no claim is
          made about the real house.
        </p>
      </div>
    );
  }

  // 1 — measured
  if (!first) {
    const night = state.nights[0];
    const ids = Object.keys(night.room_temperature_series);
    const startAvg = mean(ids.map((id) => firstValue(night.room_temperature_series[id].values)));
    const endAvg = mean(ids.map((id) => [...night.room_temperature_series[id].values].reverse().find((v) => v != null) ?? null));
    const ts = night.weather.outdoor_temperature.timestamps;
    return (
      <div className="space-y-5">
        <Bubble emoji="🌙" title="We measured the house overnight">
          <p>
            Heating off from <b className="text-white">{utcTime(ts[0])}</b> to <b className="text-white">{utcTime(ts[ts.length - 1])}</b>. Outside it
            averaged <b className="text-white">{fmt(mean(night.weather.outdoor_temperature.values), 1)}°C</b>, and the rooms cooled from about{" "}
            <b className="text-white">{fmt(startAvg, 0)}°C</b> to <b className="text-white">{fmt(endAvg, 0)}°C</b>.
          </p>
          <p className="text-ink-3">Tip: press ▶ under the house to replay the night and watch the rooms cool.</p>
        </Bubble>
        <BigButton onClick={inv.diagnose} busy={busy === "diagnose"} busyText="Comparing every room…">
          <Search size={17} /> Find the problem
        </BigButton>
      </div>
    );
  }

  // Revealed — the end of the story.
  if (state.truth) {
    const t = state.truth;
    const cause = CAUSE_PLAIN[t.fault_type];
    return (
      <div className="space-y-5">
        <Bubble emoji={t.diagnosis_matched ? "🎯" : "🔍"} title={t.diagnosis_matched ? "We got it right!" : "Not quite this time"}>
          <p>
            {t.fault_type === "none" ? (
              <>The house had <b className="text-white">no hidden problem</b>.</>
            ) : (
              <>
                The hidden problem was <b className="text-white">{cause?.name}</b> in the <b className="text-white">{roomName(t.actual_room_id)}</b>{" "}
                ({t.fault_type === "draft" ? `${fmt(1 + t.severity, 1)}× leakier` : `${fmt(1 + t.severity, 1)}× more heat through the walls`} than
                normal).
              </>
            )}
          </p>
          {t.repair_addressed_cause !== null && (
            <p>{t.repair_addressed_cause ? "And the repair fixed the real cause. ✅" : "The repair didn't target the real cause, which is why it couldn't help."}</p>
          )}
          {!t.diagnosis_matched && (
            <p className="text-ink-3">
              That's useful too: drafts and poor insulation can look almost identical on temperature data alone. HeatHunter would rather say
              "not sure" than guess.
            </p>
          )}
        </Bubble>
        <div className="space-y-2.5">
          <BigButton onClick={() => inv.start({ mode: "surprise" })} busy={busy === "create"} busyText="Building a new house…">
            <Dices size={17} /> Try a mystery house
          </BigButton>
          <div className="grid grid-cols-2 gap-2.5">
            <BigButton tone="plain" onClick={openJudge} disabled={!!busy}>
              <EyeOff size={16} /> Hide a problem
            </BigButton>
            <BigButton tone="plain" onClick={() => inv.start(GUIDED)} disabled={!!busy}>
              <RotateCcw size={16} /> Replay demo
            </BigButton>
          </div>
        </div>
      </div>
    );
  }

  const room = roomName(latest.flagged_room_id);
  const revealButton = (
    <BigButton tone="plain" onClick={inv.reveal} busy={busy === "reveal"} busyText="Opening the sealed answer…">
      <EyeOff size={16} /> Reveal the real answer
    </BigButton>
  );

  // Repaired.
  if (state.repair) {
    const r = state.repair;
    const delta = Number(r.diagnosed_improvement.match(/change ([+-]?[\d.]+) degC/)?.[1] ?? NaN);
    const cleared = /status: no_fault/.test(r.diagnosed_improvement);
    const roomId = latest.flagged_room_id as TwinRoomId;
    const before = r.original_observations[0].room_temperature_series[roomId];
    const after = r.repaired_observations[0].room_temperature_series[roomId];
    return (
      <div className="space-y-5">
        <Bubble emoji={cleared ? "✅" : "😕"} title={cleared ? `Fixed! The ${room} is holding its heat` : `The fix didn't help the ${room}`}>
          {cleared ? (
            <p>
              We re-ran the exact same cold night after the repair. The {room} stayed{" "}
              <b className="text-white">{Number.isFinite(delta) ? `${fmt(delta, 1)}°C warmer` : "warmer"}</b> on average, and it no longer looks
              abnormal.
            </p>
          ) : (
            <p>
              On the same night, the {room} behaved {Number.isFinite(delta) && Math.abs(delta) < 0.05 ? "exactly the same" : "almost the same"} after
              the repair. The real cause may be something else — let's check.
            </p>
          )}
        </Bubble>
        <SoftCard tone={cleared ? "ok" : "warn"}>
          <div className="mb-1 flex items-center justify-between text-[12px] text-ink-3">
            <span>{room} · same night, before vs after</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block h-[2px] w-3" style={{ background: "repeating-linear-gradient(90deg,#8b98a9 0 3px,transparent 3px 5px)" }} /> before
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-[2px] w-3 bg-ok" /> after
              </span>
            </span>
          </div>
          <TelemetryChart
            height={170}
            series={[
              { key: "before", label: "Before", color: "#8b98a9", dashed: true, series: before },
              { key: "after", label: "After", color: "var(--color-ok)", series: after, emphasis: "focus" },
            ]}
          />
          {r.remeasured_savings_kwh != null && r.remeasured_savings_kwh > 0 && (
            <p className="mt-1 text-[12.5px] text-ink-2">
              Measured saving: about <b className="num text-white">{fmt(r.remeasured_savings_kwh, 0)} kWh</b> of gas a year.
            </p>
          )}
        </SoftCard>
        <BigButton tone="warm" onClick={inv.reveal} busy={busy === "reveal"} busyText="Opening the sealed answer…">
          <EyeOff size={17} /> Reveal the real answer
        </BigButton>
      </div>
    );
  }

  if (latest.status === "no_fault") {
    return (
      <div className="space-y-5">
        <Bubble emoji="🎉" title="Good news — nothing unusual">
          <p>Every room cooled the way a healthy version of this house would. No room is losing heat abnormally fast.</p>
        </Bubble>
        {revealButton}
      </div>
    );
  }

  if (latest.status === "unexplained") {
    return (
      <div className="space-y-5">
        <Bubble emoji="🤔" title="Something's odd, but we can't explain it">
          <p>
            None of our explanations fit these measurements well enough. Rather than guess, HeatHunter says so — in a real home, this is when
            you'd collect more evidence.
          </p>
        </Bubble>
        {revealButton}
      </div>
    );
  }

  if (latest.status === "ambiguous") {
    const decision = first.test_decision;
    return (
      <div className="space-y-5">
        <Bubble emoji="🕵️" title={<>The <span className="text-warn">{room}</span> is losing heat too fast</>}>
          <p>It cools faster than it should. There are two likely reasons, and on a normal night they look almost the same:</p>
        </Bubble>
        <CauseCards diagnosis={latest} />
        {!state.experimentRun && decision?.recommended ? (
          <SoftCard tone="accent">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                <Fan size={20} />
              </span>
              <div>
                <div className="text-[15px] font-semibold text-white">A quick fan test can tell them apart</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  Running an extractor fan pulls outside air in through any gaps. A leaky room cools faster with the fan on; a poorly
                  insulated one barely changes.
                </p>
              </div>
            </div>
            <div className="mt-3">
              <BigButton onClick={() => inv.runExperiment(first.diagnosis_id)} busy={busy === "experiment"} busyText="Running the fan test overnight…">
                <Fan size={17} /> Run the fan test
              </BigButton>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">⚠ {decision.safety_warning}</p>
          </SoftCard>
        ) : (
          <SoftCard>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {state.experimentRun
                ? "Even with the fan test, the two causes are still too close to call. HeatHunter won't guess — so we stop here rather than recommend the wrong repair."
                : "A fan test wouldn't help here: both causes are predicted to react the same way. We won't recommend a repair we can't justify."}
            </p>
          </SoftCard>
        )}
        {(state.experimentRun || !decision?.recommended) && revealButton}
      </div>
    );
  }

  // Confident.
  const cause = plainCause(latest.ranked_causes[0]);
  return (
    <div className="space-y-5">
      <Bubble
        emoji="💡"
        title={
          <>
            Found it: <span className="text-warn">{cause?.name}</span> in the {room}
          </>
        }
      >
        <p>
          {state.experimentRun ? "The fan test settled it. " : ""}
          {cause?.how} This explanation fits the measurements clearly better than the alternative.
        </p>
      </Bubble>
      <Money inv={inv} diagnosis={latest} />
      <SoftCard>
        <div className="mb-3 text-[15px] font-semibold text-white">Try the fix: {cause?.fix.toLowerCase()}</div>
        <Slider
          label="How thorough is the repair?"
          value={effectiveness}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(effectiveness * 100)}%`}
          onChange={setEffectiveness}
        />
        <div className="mt-4">
          <BigButton onClick={() => inv.repair(latest.diagnosis_id, effectiveness)} busy={busy === "repair"} busyText="Repairing & re-measuring…">
            <Hammer size={17} /> {cause?.fix ?? "Apply the fix"}
          </BigButton>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-3">We fix what we diagnosed — if we're wrong, you'll see the fix doesn't help.</p>
      </SoftCard>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function SimpleLab({ inv, twin }: { inv: InvestigationApi; twin: TwinState }) {
  const { state } = inv;
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const { selected, setSelected, readings, range, night, length, index, setIndex, playing, setPlaying, cursorIso, fanOnNow, latest, flagged, dataset, datasets, datasetKey, setDatasetKey } = twin;
  const sel = selected ? readings[selected] : undefined;

  return (
    <div className="mx-auto max-w-[1380px] space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-white sm:text-[30px]">Home heat check</h1>
          <p className="mt-1 text-[14px] text-ink-3">
            A simulated version of a real English bungalow{state.mode === "guided" ? " · guided demo" : state.mode ? " · hidden-problem mode" : ""}
          </p>
        </div>
        {state.scenarioId && (
          <button className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[13px] text-ink-2 hover:bg-white/5 hover:text-white" onClick={inv.reset}>
            <RotateCcw size={14} /> Start over
          </button>
        )}
      </div>

      <Stepper inv={inv} />

      {state.error && <ErrorNote message={state.error} onRetry={inv.dismissError} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-b from-[#0d141c] to-[#090d12] shadow-[0_30px_80px_-40px_rgba(34,211,238,0.35)]">
            <TwinView
              readings={readings}
              range={range}
              selected={selected}
              onSelect={(id) => setSelected((s) => (s === id ? null : id))}
              flagged={flagged}
              status={latest?.status ?? null}
              truthRoom={state.truth?.actual_room_id ?? null}
              repairedRoom={state.repair && dataset?.repaired ? latest?.flagged_room_id ?? null : null}
              fanOn={fanOnNow}
              idle={!state.scenarioId}
              simpleLabels
              height={520}
            />
            {night && (
              <div className="flex flex-wrap items-center gap-3 border-t border-white/8 px-4 py-3">
                <button
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/20 text-accent hover:bg-accent/30"
                  onClick={() => {
                    if (index >= length - 1) setIndex(0);
                    setPlaying((p) => !p);
                  }}
                  aria-label={playing ? "Pause" : "Replay the night"}
                >
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <div className="min-w-0 flex-1 basis-40">
                  <input
                    type="range"
                    className="range"
                    min={0}
                    max={Math.max(0, length - 1)}
                    value={index}
                    onChange={(e) => {
                      setPlaying(false);
                      setIndex(Number(e.target.value));
                    }}
                    style={{ "--fill": `${(index / Math.max(1, length - 1)) * 100}%` } as React.CSSProperties}
                    aria-label="Time of night"
                  />
                </div>
                <span className="num shrink-0 text-[13px] text-ink-2">{cursorIso ? utcTime(cursorIso) : "—"}</span>
                {datasets.length > 1 && (
                  <select
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[12.5px] text-ink"
                    value={datasetKey}
                    onChange={(e) => setDatasetKey(e.target.value)}
                    aria-label="Which night to show"
                  >
                    {datasets.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.repaired ? "After repair" : d.night.kind === "fan_test" ? "Fan-test night" : "Normal night"}
                        {d.repaired ? (d.night.kind === "fan_test" ? " (fan)" : " (normal)") : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {sel && selected && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-[13.5px]">
              <span className="flex items-center gap-2 font-semibold text-white">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TWIN_ROOMS[selected].color }} />
                {TWIN_ROOMS[selected].name}
              </span>
              <span className="text-ink-2">
                <b className="num text-white">{fmt(sel.temp)}°C</b> now
              </span>
              {sel.drop != null && (
                <span className="text-ink-2">
                  cooled <b className="num text-white">{fmt(sel.drop, 1)}°C</b> since the start
                </span>
              )}
              {flagged === selected && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11.5px] font-semibold text-warn">⚠ losing heat fast</span>}
            </div>
          )}

          {night && (
            <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
              <button className="flex w-full items-center justify-between px-4 py-3 text-[13.5px] text-ink-2 hover:text-white" onClick={() => setChartOpen((o) => !o)} aria-expanded={chartOpen}>
                <span className="flex items-center gap-2">
                  <Activity size={14} /> See the temperature chart
                </span>
                <ChevronDown size={16} className={`transition ${chartOpen ? "rotate-180" : ""}`} />
              </button>
              {chartOpen && (
                <div className="border-t border-white/8 px-3 pb-3 pt-2">
                  <TelemetryChart series={twin.chartSeries} fan={twin.fan} cursor={cursorIso} height={240} />
                  <p className="px-1 text-[11.5px] text-ink-3">Coloured lines: rooms (simulated sensors). Dashed: outdoor temperature (real SMETER weather station readings, interpolated to 5-minute steps).</p>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-3xl border border-white/8 bg-gradient-to-b from-[#121a24] to-[#0d1219] p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)] sm:p-6">
            <Assistant inv={inv} openJudge={() => setJudgeOpen(true)} />
          </div>
          {state.mode === "guided" && (
            <p className="mt-3 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-ink-4">
              <Info size={13} className="mt-0.5 shrink-0" />
              About this demo: it uses a practice example picked because it shows every step, so don't take it as typical — other homes
              can end with "not sure". Everything you see is calculated live.
            </p>
          )}
          {state.mode && state.mode !== "guided" && !state.truth && (
            <p className="mt-3 flex items-start gap-2 px-1 text-[12px] text-ink-4">
              <XCircle size={13} className="mt-0.5 shrink-0" /> The hidden problem is sealed — HeatHunter can't see it either.
            </p>
          )}
        </aside>
      </div>

      {judgeOpen && (
        <JudgeDialog
          onClose={() => setJudgeOpen(false)}
          onLaunch={(request) => {
            setJudgeOpen(false);
            inv.start(request);
          }}
        />
      )}
    </div>
  );
}
