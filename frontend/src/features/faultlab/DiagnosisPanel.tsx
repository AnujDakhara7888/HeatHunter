import { ArrowRight, Info, Minus, TrendingDown } from "lucide-react";
import type { Diagnosis, HypothesisFit } from "../../lib/api";
import { numericAssumption } from "../../lib/assumptions";
import { fmt } from "../../lib/format";
import { CAUSE_LABEL, roomName } from "../../lib/rooms";
import { Locked, Panel, ProvenanceTag, STATUS_META, StatusBadge, Spinner } from "../../components/ui";

export function causeGap(d: Diagnosis): number | null {
  return d.ranked_causes.length > 1 ? d.ranked_causes[1].bic - d.ranked_causes[0].bic : null;
}

/** "Best fault improves BIC over normal by X" — emitted by the diagnosis controller. */
function anomalyScore(d: Diagnosis): number | null {
  for (const e of d.evidence) {
    const match = e.statement.match(/over normal by (-?[\d.]+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function multiplierText(fit: HypothesisFit): string {
  if (fit.fault_type === "draft") return `leakage ×${fmt(fit.fitted_multiplier, 2)} of nominal`;
  if (fit.fault_type === "envelope_conduction") return `envelope conductance ×${fmt(fit.fitted_multiplier, 2)} of nominal`;
  return "nominal parameters";
}

function Meter({
  label,
  value,
  threshold,
  unit,
  passLabel,
  failLabel,
}: {
  label: string;
  value: number | null;
  threshold: number | null;
  unit: string;
  passLabel: string;
  failLabel: string;
}) {
  if (value === null) return null;
  const max = Math.max(value, threshold ?? 0) * 1.25 || 1;
  const pass = threshold !== null && value >= threshold;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="micro">{label}</span>
        <span className="num text-[12px]">
          <span className="text-ink">{fmt(value, 1)}</span>
          {threshold !== null && <span className="text-ink-3"> / {fmt(threshold, 1)} {unit}</span>}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#1a2330]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(2, Math.min(100, (value / max) * 100))}%`,
            background: pass ? "var(--color-accent)" : "#4b5a6d",
          }}
        />
        {threshold !== null && (
          <div className="absolute -top-1 -bottom-1 w-[2px] bg-ink" style={{ left: `${(threshold / max) * 100}%` }} title="Threshold" />
        )}
      </div>
      {threshold !== null && (
        <div className={`mt-1 text-[10.5px] ${pass ? "text-accent" : "text-ink-3"}`}>{pass ? passLabel : failLabel}</div>
      )}
    </div>
  );
}

function interpretation(d: Diagnosis, ambiguityThreshold: number | null): string {
  const room = roomName(d.flagged_room_id);
  const lead = d.ranked_causes[0];
  const gap = causeGap(d);
  switch (d.status) {
    case "no_fault":
      return "Every room's cooling is consistent with the healthy HH09 twin within the calibrated detection threshold. No abnormal heat loss is flagged.";
    case "unexplained":
      return d.flagged_room_id
        ? `${room} looks abnormal, but the best available model does not fit its measurements adequately. HeatHunter will not guess a cause.`
        : "None of our available models adequately explains these measurements. More evidence is needed.";
    case "ambiguous":
      return `${room} is losing heat faster than the healthy twin predicts. Both an air leak and extra envelope conduction can reproduce its cooling curve: the fit difference (${fmt(gap, 1)} BIC) is below the ${fmt(ambiguityThreshold, 1)} BIC needed to call one cause.`;
    case "confident":
      return `${CAUSE_LABEL[lead.fault_type]} in the ${room} explains the measurements clearly better than the alternative (gap ${fmt(gap, 1)} BIC ≥ ${fmt(ambiguityThreshold, 1)}). Fitted: ${multiplierText(lead)}.`;
  }
}

function RankRow({ fit, rank, best, adequacy }: { fit: HypothesisFit; rank: number; best: number; adequacy: number | null }) {
  const delta = fit.bic - best;
  const adequate = adequacy === null || fit.residual_rmse_deg_c <= adequacy;
  return (
    <div className={`grid grid-cols-[22px_1fr_auto] items-center gap-x-3 rounded border px-3 py-2.5 ${rank === 1 ? "border-line-strong bg-raised" : "border-line bg-sunken/60"}`}>
      <span className={`num text-[13px] ${rank === 1 ? "text-accent" : "text-ink-4"}`}>#{rank}</span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{CAUSE_LABEL[fit.fault_type]}</div>
        <div className="truncate text-[11px] text-ink-3">{multiplierText(fit)}</div>
      </div>
      <div className="text-right">
        <div className="num text-[12px] text-ink">{rank === 1 ? "best fit" : `+${fmt(delta, 1)} BIC`}</div>
        <div className={`num text-[10.5px] ${adequate ? "text-ink-3" : "text-crit"}`} title="Residual RMSE vs adequacy threshold">
          RMSE {fmt(fit.residual_rmse_deg_c, 3)}°C
        </div>
      </div>
    </div>
  );
}

export function DiagnosisPanel({
  diagnoses,
  busy,
  canDiagnose,
  onDiagnose,
}: {
  diagnoses: Diagnosis[];
  busy: boolean;
  canDiagnose: boolean;
  onDiagnose: () => void;
}) {
  const latest = diagnoses[diagnoses.length - 1];
  const before = diagnoses.length > 1 ? diagnoses[0] : null;

  if (!latest) {
    return (
      <Panel code="03" title="Diagnosis" right={<ProvenanceTag value="MODEL_ESTIMATE" />}>
        {canDiagnose ? (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Fit three competing explanations — <b className="text-ink">normal</b>, <b className="text-ink">air leak</b> and{" "}
              <b className="text-ink">envelope conduction</b> — to every room's cooling curve, then rank them by BIC.
            </p>
            <button className="btn btn-primary w-full" onClick={onDiagnose} disabled={busy}>
              {busy ? <Spinner /> : <TrendingDown size={15} />} {busy ? "Fitting 12 hypotheses…" : "Analyze house"}
            </button>
          </div>
        ) : (
          <Locked>Load a scenario to collect temperature evidence first.</Locked>
        )}
      </Panel>
    );
  }

  const ambiguity = numericAssumption(latest.assumptions, "threshold_ambiguity_bic");
  const detection = numericAssumption(latest.assumptions, "threshold_detection_bic");
  const adequacy = numericAssumption(latest.assumptions, "threshold_adequacy_rmse");
  const meta = STATUS_META[latest.status];
  const best = latest.ranked_causes[0]?.bic ?? 0;

  return (
    <Panel
      code="03"
      title={before ? "Diagnosis · updated" : "Diagnosis"}
      right={<ProvenanceTag value="MODEL_ESTIMATE" />}
      tone={latest.status === "confident" ? "warn" : latest.status === "no_fault" ? "ok" : "accent"}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={latest.status} size="lg" />
          {latest.flagged_room_id && (
            <span className="text-[12px] text-ink-2">
              Flagged room <b className="ml-1 text-ink">{roomName(latest.flagged_room_id)}</b>
            </span>
          )}
        </div>

        <p className="border-l-2 pl-3 text-[13px] leading-relaxed text-ink" style={{ borderColor: meta.color }}>
          {interpretation(latest, ambiguity)}
        </p>

        {before && (
          <div className="rounded border border-line bg-sunken px-3 py-2.5">
            <div className="micro mb-2">Before → after fan test</div>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <StatusBadge status={before.status} />
              <span className="text-ink-3">{before.ranked_causes[0] ? CAUSE_LABEL[before.ranked_causes[0].fault_type] : "—"}</span>
              <ArrowRight size={14} className="text-ink-4" />
              <StatusBadge status={latest.status} />
              <span className="text-ink">{latest.ranked_causes[0] ? CAUSE_LABEL[latest.ranked_causes[0].fault_type] : "—"}</span>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              Refitting with the fan-test night moved the leading-cause gap from{" "}
              <span className="num text-ink-2">{fmt(causeGap(before), 1)}</span> to{" "}
              <span className="num text-ink-2">{fmt(causeGap(latest), 1)}</span> BIC. Infiltration responds to forced extraction; fabric
              conduction does not, so this night carries information the passive night lacked.
            </p>
          </div>
        )}

        {latest.ranked_causes.length > 0 && (
          <div className="space-y-1.5">
            <div className="micro flex items-center justify-between">
              <span>Ranked explanations · {roomName(latest.flagged_room_id)}</span>
              <span title="Lower BIC = better fit after penalizing parameters">lower BIC = better</span>
            </div>
            {latest.ranked_causes.map((fit, i) => (
              <RankRow key={fit.fault_type} fit={fit} rank={i + 1} best={best} adequacy={adequacy} />
            ))}
          </div>
        )}

        {latest.ranked_causes.length > 0 && (
          <div className="space-y-3 rounded border border-line bg-sunken/60 p-3">
            <Meter
              label="Fault vs normal (anomaly score)"
              value={anomalyScore(latest)}
              threshold={detection}
              unit="BIC"
              passLabel="Above detection threshold — abnormal heat loss detected"
              failLabel="Below detection threshold"
            />
            <Meter
              label="Gap between leading causes"
              value={causeGap(latest)}
              threshold={ambiguity}
              unit="BIC"
              passLabel="Clear winner — cause identified"
              failLabel="Too close to call — causes not distinguished"
            />
          </div>
        )}

        <div className="space-y-1.5">
          {latest.evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-2">
              <span className={`mt-0.5 font-mono text-[9.5px] uppercase ${e.relationship === "supports" ? "text-accent" : e.relationship === "contradicts" ? "text-crit" : "text-ink-3"}`}>
                {e.relationship}
              </span>
              <span className="min-w-0 flex-1">{e.statement}</span>
            </div>
          ))}
          {latest.uncertainty.map((u, i) => (
            <div key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
              {i === 0 ? <Info size={12} className="mt-0.5 shrink-0" /> : <Minus size={12} className="mt-0.5 shrink-0" />}
              <span>{u}</span>
            </div>
          ))}
        </div>
        <p className="text-[10.5px] text-ink-4">BIC differences are fit scores, not probabilities. Thresholds: provisional TRAINING-split calibration.</p>
      </div>
    </Panel>
  );
}
