import { ExternalLink, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Diagnosis, MoneyEstimate, MoneyResponse } from "../../lib/api";
import { isUnverified, numericAssumption } from "../../lib/assumptions";
import { fmt, gbp, usd } from "../../lib/format";
import { CAUSE_LABEL, REPAIR_LABEL, roomName } from "../../lib/rooms";
import { Locked, Panel, ProvenanceTag, Slider, Spinner, Stat } from "../../components/ui";

const LABELS: Record<string, string> = {
  heating_degree_days: "Heating degree days (base 15.5 °C)",
  heating_efficiency: "Boiler seasonal efficiency",
  gas_unit_price: "Gas unit price",
  gbp_to_usd: "GBP → USD rate",
  repair_cost_seal_leaks: "Draught-proofing cost",
  repair_cost_add_insulation: "Internal wall insulation rate",
  thermal_mass_parameter: "Thermal mass parameter",
  annual_energy_basis: "Energy basis",
  heating_season_mean_wind_speed: "Heating-season mean wind",
  repair_cost_user_override: "Repair cost (your override)",
};

export function MoneyPanel({
  diagnosis,
  money,
  busy,
  onReprice,
}: {
  diagnosis: Diagnosis | undefined;
  money: MoneyResponse | null;
  busy: boolean;
  onReprice: (diagnosisId: string, gasPrice: number | null, repairCost: number | null) => void;
}) {
  const base = diagnosis?.money_estimate ?? null;
  const fx = numericAssumption(base?.assumptions, "gbp_to_usd");
  const defaultPrice = numericAssumption(base?.assumptions, "gas_unit_price");
  const defaultRepair = base && fx ? base.repair_cost_usd / fx : null;
  const [price, setPrice] = useState<number | null>(null);
  const [repair, setRepair] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setPrice(null);
    setRepair(null);
  }, [diagnosis?.diagnosis_id]);

  const estimate: MoneyEstimate | null =
    money && money.diagnosis_id === diagnosis?.diagnosis_id && (price !== null || repair !== null) ? money.estimate : base;

  const schedule = (nextPrice: number | null, nextRepair: number | null) => {
    if (!diagnosis) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onReprice(diagnosis.diagnosis_id, nextPrice, nextRepair), 220);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sortedAssumptions = useMemo(() => estimate?.assumptions ?? [], [estimate]);

  if (!diagnosis || diagnosis.status !== "confident") {
    return (
      <Panel code="05" title="Cost of the heat loss">
        <Locked>
          {diagnosis
            ? `No cost estimate for a ${diagnosis.status.replace("_", " ")} result — HeatHunter only prices a cause it can identify.`
            : "Costs are estimated only for a confident diagnosis."}
        </Locked>
      </Panel>
    );
  }
  if (!estimate || !fx) {
    return (
      <Panel code="05" title="Cost of the heat loss">
        <Locked>The fitted cause does not indicate an excess heat-loss path to price.</Locked>
      </Panel>
    );
  }

  const annualGbp = estimate.annual_cost_estimate_usd / fx;
  const repairGbp = estimate.repair_cost_usd / fx;
  const lead = diagnosis.ranked_causes[0];

  return (
    <Panel code="05" title="Cost of the heat loss" right={<ProvenanceTag value="MODEL_ESTIMATE" />}>
      <div className="space-y-4">
        <p className="text-[12px] leading-relaxed text-ink-2">
          Screening estimate if the fitted <b className="text-ink">{CAUSE_LABEL[lead.fault_type].toLowerCase()}</b> in the{" "}
          {roomName(diagnosis.flagged_room_id)} persisted all heating season in a home like HH09 (England, gas boiler).
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded border border-line bg-sunken p-3">
          <Stat
            label="Annual cost"
            value={gbp(annualGbp)}
            tone="var(--color-warn)"
            sub={<span className="num">≈ {usd(estimate.annual_cost_estimate_usd)} at {fmt(fx, 4)} USD/GBP</span>}
          />
          <Stat label="Extra gas per year" value={fmt(estimate.annual_energy_estimate_kwh, 0)} unit="kWh" sub="after boiler efficiency" />
          <Stat label="Excess heat loss" value={fmt(estimate.excess_conductance_w_per_k, 1)} unit="W/K" sub="fitted − nominal path" />
          <Stat
            label="Simple payback"
            value={estimate.simple_payback_years != null ? fmt(estimate.simple_payback_years, 1) : "—"}
            unit="yr"
            sub={<span className="num">{REPAIR_LABEL[lead.fault_type].toLowerCase()} · {gbp(repairGbp)}</span>}
          />
        </div>

        <div className="space-y-4 rounded border border-line p-3">
          <div className="flex items-center justify-between">
            <span className="micro">What-if (recomputed by the engine)</span>
            <span className="flex items-center gap-2">
              {busy && <Spinner size={12} />}
              <button
                className="btn btn-ghost h-6 px-2 text-[11px]"
                disabled={price === null && repair === null}
                onClick={() => {
                  setPrice(null);
                  setRepair(null);
                  window.clearTimeout(timer.current);
                }}
              >
                <RotateCcw size={12} /> Sourced defaults
              </button>
            </span>
          </div>
          <Slider
            label="Gas tariff"
            value={price ?? defaultPrice ?? 8}
            min={2}
            max={25}
            step={0.1}
            display={`${fmt(price ?? defaultPrice, 2)} p/kWh`}
            onChange={(v) => {
              setPrice(v);
              schedule(v, repair);
            }}
          />
          <Slider
            label="Repair cost"
            value={repair ?? defaultRepair ?? 0}
            min={0}
            max={Math.max(3000, Math.ceil((defaultRepair ?? 0) * 2))}
            step={25}
            display={gbp(repair ?? defaultRepair)}
            onChange={(v) => {
              setRepair(v);
              schedule(price, v);
            }}
          />
        </div>

        <details className="group rounded border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11.5px] text-ink-2 hover:text-ink">
            <span className="micro">Assumptions ({sortedAssumptions.length})</span>
            <span className="text-ink-4 group-open:rotate-90">›</span>
          </summary>
          <div className="space-y-2 border-t border-line px-3 py-2.5">
            {sortedAssumptions.map((a) => (
              <div key={a.name} className="text-[11.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-2">{LABELS[a.name] ?? a.name}</span>
                  <span className="num text-right text-ink">
                    {typeof a.value === "number" ? fmt(a.value, a.value < 10 ? 3 : 1) : String(a.value)} {a.unit ?? ""}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-4">
                  {isUnverified(a) && <span className="rounded-[2px] bg-warn-dim px-1 font-mono text-[9.5px] text-warn">UNVERIFIED</span>}
                  {a.source?.provider && <span>{a.source.provider}</span>}
                  {a.source?.url && (
                    <a href={a.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent/80 hover:text-accent">
                      source <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
        <p className="text-[10.5px] leading-relaxed text-ink-4">
          Standing charges excluded. Screening estimate from explicit assumptions — not an audited saving. Repair costs are
          illustrative and user-adjustable.
        </p>
      </div>
    </Panel>
  );
}
