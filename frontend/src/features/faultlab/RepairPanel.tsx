import { CheckCircle2, Hammer, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { Diagnosis, NightObservations, RepairResult } from "../../lib/api";
import { numericAssumption } from "../../lib/assumptions";
import { fmt, gbp } from "../../lib/format";
import { REPAIR_LABEL, roomName, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";
import { TelemetryChart } from "../../components/TelemetryChart";
import { Locked, Panel, ProvenanceTag, Slider, Spinner, Stat } from "../../components/ui";

/** Parses the repair service's summary sentence; falls back to showing it verbatim. */
function parseImprovement(text: string): { delta: number | null; status: string | null } {
  const delta = text.match(/change ([+-]?[\d.]+) degC/);
  const status = text.match(/status: ([a-z_]+)/);
  return { delta: delta ? Number(delta[1]) : null, status: status ? status[1] : null };
}

function nightLabel(n: NightObservations): string {
  return n.kind === "fan_test" ? "Fan-test night" : "Passive night";
}

export function RepairPanel({
  diagnosis,
  repair,
  busy,
  onRepair,
}: {
  diagnosis: Diagnosis | undefined;
  repair: RepairResult | null;
  busy: boolean;
  onRepair: (diagnosisId: string, effectiveness: number) => void;
}) {
  const [effectiveness, setEffectiveness] = useState(1);
  const [nightIndex, setNightIndex] = useState(0);

  const room = (repair ? diagnosis?.flagged_room_id : diagnosis?.flagged_room_id) as TwinRoomId | null | undefined;
  const chart = useMemo(() => {
    if (!repair || !room) return null;
    const i = Math.min(nightIndex, repair.original_observations.length - 1);
    const original = repair.original_observations[i];
    const repaired = repair.repaired_observations[i];
    const p = original.protocol;
    return {
      night: original,
      fan: p.fan_on && p.fan_start && p.fan_end ? { start: p.fan_start, end: p.fan_end } : null,
      series: [
        { key: "before", label: "Before repair", color: "#8b98a9", dashed: true, series: original.room_temperature_series[room] },
        { key: "after", label: "After repair", color: "var(--color-ok)", series: repaired.room_temperature_series[room], emphasis: "focus" as const },
        { key: "outdoor", label: "Outdoor", color: "#475262", dashed: true, series: original.weather.outdoor_temperature, emphasis: "dim" as const },
      ],
    };
  }, [repair, room, nightIndex]);

  if (!diagnosis || diagnosis.status !== "confident") {
    return (
      <Panel code="06" title="Repair & verify">
        <Locked>
          {diagnosis
            ? "A repair needs a confident diagnosis. HeatHunter will not recommend a fix it cannot justify."
            : "Available after a confident diagnosis."}
        </Locked>
      </Panel>
    );
  }

  const lead = diagnosis.ranked_causes[0];
  const repairName = REPAIR_LABEL[lead.fault_type];

  if (!repair) {
    return (
      <Panel code="06" title="Repair & verify">
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Apply the <b className="text-ink">diagnosed</b> repair — <b className="text-ink">{repairName.toLowerCase()}</b> in the{" "}
            {roomName(diagnosis.flagged_room_id)} — then re-run the twin with identical weather, seed and starting temperatures. If
            the diagnosis is wrong, the fix may change nothing, and you will see that.
          </p>
          <Slider
            label="Repair effectiveness"
            value={effectiveness}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(effectiveness * 100)}% of excess removed`}
            onChange={setEffectiveness}
          />
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => onRepair(diagnosis.diagnosis_id, effectiveness)}>
            {busy ? <Spinner /> : <Hammer size={15} />} {busy ? "Re-simulating & re-measuring…" : `Apply fix · ${repairName}`}
          </button>
        </div>
      </Panel>
    );
  }

  const parsed = parseImprovement(repair.diagnosed_improvement);
  const cleared = parsed.status === "no_fault";
  const unchanged = parsed.delta !== null && Math.abs(parsed.delta) < 0.0005;
  const price = numericAssumption(repair.estimated_savings?.assumptions, "gas_unit_price");

  return (
    <Panel code="06" title="Repair & verify" right={<ProvenanceTag value="SIMULATED_MEASUREMENT" />} tone={cleared ? "ok" : "warn"}>
      <div className="space-y-4">
        <div
          className={`flex items-start gap-2.5 rounded border px-3 py-2.5 text-[12.5px] leading-relaxed ${
            cleared ? "border-ok/40 bg-ok-dim text-[#c8f0dc]" : "border-warn/40 bg-warn-dim text-[#f6d79c]"
          }`}
        >
          {cleared ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-warn" />}
          <span>
            {cleared
              ? "Anomaly cleared: after the repair the public model finds no abnormal room."
              : unchanged
                ? "The repair changed nothing measurable. The diagnosed path may not be the real cause — reveal the answer to check."
                : `Abnormal behaviour persists after the repair (post-repair status: ${parsed.status ?? "unknown"}).`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded border border-line bg-sunken p-3">
          <Stat
            label="Paired temp change"
            value={parsed.delta !== null ? `${parsed.delta >= 0 ? "+" : ""}${fmt(parsed.delta, 2)}` : "—"}
            unit="°C"
            tone={parsed.delta && parsed.delta > 0.05 ? "var(--color-ok)" : undefined}
            sub={`${roomName(room)} · same weather & sensor noise`}
          />
          <Stat label="Effectiveness" value={`${Math.round(repair.effectiveness * 100)}%`} sub={REPAIR_LABEL[repair.repair_type]} />
          <Stat
            label="Predicted saving"
            value={repair.estimated_savings ? fmt(repair.estimated_savings.annual_energy_estimate_kwh, 0) : "—"}
            unit="kWh/yr"
            sub="from the fit; full removal"
          />
          <Stat
            label="Re-measured saving"
            value={repair.remeasured_savings_kwh != null ? fmt(repair.remeasured_savings_kwh, 0) : "—"}
            unit="kWh/yr"
            tone={repair.remeasured_savings_kwh ? "var(--color-ok)" : undefined}
            sub={
              repair.remeasured_savings_kwh != null && price != null
                ? `≈ ${gbp((repair.remeasured_savings_kwh * price) / 100)}/yr at ${fmt(price, 2)} p/kWh`
                : "refit on simulated re-measurement"
            }
          />
        </div>

        {chart && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="micro">{roomName(room)} · before vs after</span>
              <div className="flex gap-1">
                {repair.original_observations.map((n, i) => (
                  <button
                    key={n.night_id + i}
                    className={`rounded-[3px] border px-2 py-[2px] text-[10.5px] ${nightIndex === i ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}
                    onClick={() => setNightIndex(i)}
                  >
                    {nightLabel(n)}
                  </button>
                ))}
              </div>
            </div>
            <TelemetryChart series={chart.series} fan={chart.fan} height={200} />
            <div className="mt-1 flex items-center gap-3 text-[10.5px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-3" style={{ background: "repeating-linear-gradient(90deg,#8b98a9 0 3px,transparent 3px 5px)" }} /> before
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-3 bg-ok" /> after repair
              </span>
              <span className="ml-auto" style={{ color: room ? TWIN_ROOMS[room]?.color : undefined }}>
                ● {roomName(room)}
              </span>
            </div>
          </div>
        )}
        <p className="text-[10.5px] leading-relaxed text-ink-4">{repair.diagnosed_improvement}</p>
      </div>
    </Panel>
  );
}
