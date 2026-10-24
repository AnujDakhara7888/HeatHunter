import { AlertTriangle, CheckCircle2, FlaskConical, Fan } from "lucide-react";
import type { Diagnosis, NightObservations } from "../../lib/api";
import { numericAssumption } from "../../lib/assumptions";
import { fmt, utcDateTime } from "../../lib/format";
import { KeyValue, Locked, Notice, Panel, ProvenanceTag, Spinner } from "../../components/ui";

function SeparationGauge({ score, threshold }: { score: number; threshold: number | null }) {
  const max = Math.max(score, threshold ?? 0, 1) * 1.3;
  const pass = threshold !== null && score >= threshold;
  return (
    <div className="rounded border border-line bg-sunken p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="micro">Predicted discrimination</span>
        <span className="num text-[18px] text-ink">
          {fmt(score, 2)}
          <span className="text-[11px] text-ink-3">σ</span>
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-[#1a2330]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(score / max) * 100}%`, background: pass ? "linear-gradient(90deg,#0e7490,#22d3ee)" : "#4b5a6d" }}
        />
        {threshold !== null && <div className="absolute inset-y-0 w-[2px] bg-ink" style={{ left: `${(threshold / max) * 100}%` }} />}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        RMS difference between the two leading hypotheses' predicted temperatures during the test, divided by expected sensor noise.
        {threshold !== null && <> Recommend when ≥ {fmt(threshold, 1)}σ.</>} A heuristic: it ignores model bias and sensor offsets.
      </p>
    </div>
  );
}

export function TestPanel({
  first,
  fanNight,
  busy,
  onRun,
}: {
  first: Diagnosis | undefined;
  fanNight: NightObservations | undefined;
  busy: boolean;
  onRun: (diagnosisId: string) => void;
}) {
  const decision = first?.test_decision;
  const threshold = numericAssumption(first?.assumptions, "threshold_separation");

  if (!first) {
    return (
      <Panel code="04" title="Next test">
        <Locked>A test is evaluated only after the first diagnosis.</Locked>
      </Panel>
    );
  }

  if (fanNight) {
    const p = fanNight.protocol;
    return (
      <Panel code="04" title="E1 test complete" right={<ProvenanceTag value="SIMULATED_MEASUREMENT" />} tone="accent">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px] text-ink">
            <CheckCircle2 size={15} className="text-accent" /> New observations recorded and all hypotheses refitted.
          </div>
          <div className="rounded border border-line bg-sunken px-3 py-1">
            <KeyValue k="Weather night" v={fanNight.night_id} />
            <KeyValue k="Fan airflow (assumed)" v={`${fmt(p.fan_airflow_m3_per_h, 1)} m³/h`} />
            <KeyValue k="Fan on" v={p.fan_start ? utcDateTime(p.fan_start) : "—"} />
            <KeyValue k="Fan off" v={p.fan_end ? utcDateTime(p.fan_end) : "—"} />
            <KeyValue k="Heating / doors" v={`${p.heating_off ? "off" : "on"} / ${p.doors_closed ? "closed" : "open"}`} />
          </div>
        </div>
      </Panel>
    );
  }

  if (!decision) {
    return (
      <Panel code="04" title="Next test">
        <Notice>
          {first.status === "no_fault"
            ? "No abnormal room was found, so there is nothing for an extra test to discriminate."
            : first.status === "unexplained"
              ? "The available models don't fit well enough to predict how a test would respond. More or different evidence is needed."
              : "No additional test is indicated."}
        </Notice>
      </Panel>
    );
  }

  if (!decision.recommended) {
    return (
      <Panel code="04" title="Next test · not recommended">
        <div className="space-y-3">
          <Notice>{decision.explanation}</Notice>
          {decision.separation_score != null && <SeparationGauge score={decision.separation_score} threshold={threshold} />}
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            HeatHunter only recommends an experiment when the competing explanations predict measurably different responses.
            Running an uninformative test would not resolve the ambiguity.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel code="04" title="Recommended test" right={<ProvenanceTag value="MODEL_ESTIMATE" />} tone="accent" brackets>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded border border-accent/40 bg-accent-dim text-accent">
            <Fan size={20} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">E1 · Exhaust-fan depressurization</div>
            <div className="text-[11.5px] text-ink-3">Simulated · heating off · doors closed · second night</div>
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Extracting air pulls replacement air through leakage paths. If the flagged room has an <b className="text-ink">air leak</b>,
          it should cool noticeably faster with the fan on; if the excess loss is <b className="text-ink">conduction</b>, the fan
          changes little. {decision.explanation}
        </p>
        {decision.separation_score != null && <SeparationGauge score={decision.separation_score} threshold={threshold} />}
        {decision.safety_warning && (
          <div className="flex items-start gap-2 rounded border border-warn/35 bg-warn-dim px-3 py-2 text-[11.5px] leading-relaxed text-[#f6d79c]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
            <span>{decision.safety_warning}</span>
          </div>
        )}
        <button className="btn btn-primary w-full" disabled={busy} onClick={() => onRun(first.diagnosis_id)}>
          {busy ? <Spinner /> : <FlaskConical size={15} />} {busy ? "Simulating fan night & refitting…" : "Run recommended test"}
        </button>
        <p className="text-[10.5px] text-ink-4">
          A household exhaust fan is not a blower door. This controlled simulation is not a validated procedure for occupied homes.
        </p>
      </div>
    </Panel>
  );
}
