import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import scan from "../../../shared/fixtures/guided_seed_scan.json";
import { api, ApiRequestError, type EvaluationSummary, type Provenance } from "../lib/api";
import { fmt } from "../lib/format";
import { useRegisterModal } from "../lib/modal";
import { ProvenanceTag, Spinner } from "./ui";

const PROVENANCE: [Provenance, string][] = [
  ["REAL_MEASUREMENT", "Recorded by a physical sensor in the SMETER Phase 2 study (HH09 rooms, weather station)."],
  ["SIMULATED_MEASUREMENT", "Produced by the hidden truth simulator through a virtual sensor model with noise and dropouts."],
  ["MODEL_ESTIMATE", "Computed by the public diagnostic model: fits, BIC, predictions, interpolated weather, costs."],
  ["ASSUMPTION", "An explicit input we chose or sourced: tariffs, efficiencies, thresholds, ceiling height."],
  ["SIMULATED_GROUND_TRUTH", "The injected fault, sealed until you press Reveal."],
];

const SOURCES = [
  ["SMETER Phase 2 dataset (UK Data Service, SN 856978)", "https://doi.org/10.5255/UKDA-SN-856978"],
  ["Ofgem energy price cap", "https://www.ofgem.gov.uk/energy-price-cap"],
  ["BRE SAP 2012, Table 1f thermal mass", "https://files.bregroup.com/SAP/SAP-2012_9-92.pdf"],
  ["ASHRAE/LBL infiltration coefficients (EnergyPlus docs)", "https://bigladdersoftware.com/epx/docs/25-2/input-output-reference/group-airflow.html"],
  ["PNNL Building America: bathroom exhaust fans", "https://basc.pnnl.gov/resource-guides/bathroom-exhaust-fans"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-line pb-5">
      <h3 className="micro text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function Pct({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 py-1.5 text-[12px] last:border-0">
      <span className="text-ink-3">{label}</span>
      <span className="num text-ink">{value == null ? "—" : `${fmt(value * 100, 1)}%`}</span>
    </div>
  );
}

function Benchmark() {
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .evaluation()
      .then(setSummary)
      .catch((e) => setError(e instanceof ApiRequestError ? e.message : String(e)));
  }, []);
  if (error)
    return (
      <div className="rounded border border-dashed border-line-strong px-3 py-3 text-[12px] leading-relaxed text-ink-3">
        The held-out benchmark report has not been generated yet, so no accuracy figure is shown. ({error})
      </div>
    );
  if (!summary)
    return (
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <Spinner size={12} /> Loading benchmark…
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="text-[12.5px] text-ink">Diagnosis accuracy on held-out simulated scenarios</div>
      <div className="text-[11px] text-ink-3">{summary.heldout_scenario_count} held-out scenarios · {summary.benchmark_id}</div>
      <div className="rounded border border-line bg-sunken px-3 py-1">
        <Pct label="Fault vs healthy detection" value={summary.fault_detection_accuracy} />
        <Pct label="Affected-room identification" value={summary.room_identification_accuracy} />
        <Pct label="Cause — before experiment" value={summary.pre_experiment_cause_classification_accuracy} />
        <Pct label="Cause — after experiment" value={summary.post_experiment_cause_classification_accuracy} />
        <Pct label="Baseline strategy" value={summary.baseline_strategy_accuracy} />
        <Pct label="False-positive rate" value={summary.false_positive_rate} />
        <Pct label="Ambiguity rate" value={summary.ambiguity_rate} />
        <Pct label="Unexplained rate" value={summary.unexplained_rate} />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-4">{summary.disclaimer}</p>
    </div>
  );
}

export function EvidenceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useRegisterModal(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const arcs = Object.entries(scan.arc_counts as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const wrongConfident = scan.rows.filter((r) => r.arc.endsWith("confident") && !r.diagnosis_matched);
  const wrongConduction = wrongConfident.filter((r) => r.final_leading_cause === "envelope_conduction");
  const wrongRightRoom = wrongConduction.filter((r) => r.final_flagged_room === "bedroom_1");
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Scientific evidence"
        className="h-full w-full max-w-[520px] overflow-y-auto border-l border-line-strong bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-5 py-3 backdrop-blur">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-ink">Scientific evidence</h2>
          <button className="btn btn-ghost h-7 w-7 p-0" onClick={onClose} aria-label="Close evidence drawer">
            <X size={14} />
          </button>
        </header>
        <div className="space-y-5 p-5">
          <Section title="Synthetic benchmark">
            <Benchmark />
          </Section>

          <Section title="Guided demo transparency">
            <p className="text-[12px] leading-relaxed text-ink-2">
              {scan.guided_fault}. Outcomes across {scan.seeds} TRAINING seeds, run through the same live pipeline. The guided demo
              uses one of the {scan.full_correct_arc_seeds.length} seeds ({scan.full_correct_arc_seeds.join(", ")}) that show the full
              correct path.
            </p>
            <div className="space-y-1.5">
              {arcs.map(([arc, count]) => (
                <div key={arc} className="grid grid-cols-[1fr_40px] items-center gap-3 text-[11.5px]">
                  <div>
                    <div className="mb-0.5 font-mono text-[10.5px] text-ink-3">{arc}</div>
                    <div className="h-1.5 rounded-full bg-[#1a2330]">
                      <div className="h-full rounded-full bg-ink-3" style={{ width: `${(count / scan.seeds) * 100}%` }} />
                    </div>
                  </div>
                  <span className="num text-right text-ink-2">{count}</span>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Final diagnosis matched the hidden fault in <b className="text-ink">{scan.diagnosis_matched}/{scan.seeds}</b>.{" "}
              {wrongConduction.length} of {wrongConfident.length} confident-but-wrong results settled on envelope conduction (
              {wrongRightRoom.length} in the correct room). Insulating a room whose real problem is a leak changes nothing, and the
              repair panel reports exactly that. This is a known limitation, not a hidden one.
            </p>
          </Section>

          <Section title="Two physics models">
            <div className="space-y-2 text-[12px] leading-relaxed text-ink-2">
              <p>
                <b className="text-ink">Truth simulator</b> — two thermal nodes per room (air + wall mass), wind- and stack-driven
                infiltration, inter-room coupling, sensor noise. It generates the measurements and holds the hidden fault.
              </p>
              <p>
                <b className="text-ink">Public diagnostic model</b> — a simpler per-room RC model with different, independently sourced
                coefficients, calibrated only on healthy TRAINING houses. It never reads the simulator's parameters.
              </p>
              <p className="text-ink-3">Using different models avoids an "inverse crime": testing a model against data generated by itself.</p>
            </div>
          </Section>

          <Section title="Provenance labels">
            <div className="space-y-2">
              {PROVENANCE.map(([p, text]) => (
                <div key={p} className="grid grid-cols-[196px_1fr] items-start gap-3">
                  <ProvenanceTag value={p} />
                  <span className="text-[11.5px] leading-snug text-ink-3">{text}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Limitations">
            <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-ink-2 marker:text-ink-4">
              <li>The Fault Lab house is an approximate HH09-inspired twin, not a reconstruction. No fault is claimed for real HH09.</li>
              <li>Simulated accuracy is not real-home accuracy. Passive cooling constrains loss/capacity, not each separately.</li>
              <li>Air leaks and conduction can produce near-identical passive cooling curves — hence "ambiguous" results.</li>
              <li>The exhaust-fan test is a simplified simulation, not a blower-door procedure, and is not validated for occupied homes.</li>
              <li>Thresholds are provisional TRAINING-split calibrations. BIC gaps and separation scores are heuristics, not probabilities.</li>
              <li>Cost figures are screening estimates; repair prices are illustrative and unverified.</li>
            </ul>
          </Section>

          <Section title="Safety">
            <p className="text-[12px] leading-relaxed text-ink-2">
              Depressurization can backdraft some natural-draft combustion appliances. This demonstration is simulated; real-world
              testing requires appropriate safety assessment.
            </p>
          </Section>

          <section className="space-y-2">
            <h3 className="micro text-ink-2">Sources</h3>
            {SOURCES.map(([label, url]) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[12px] text-accent/90 hover:text-accent">
                <ExternalLink size={11} /> {label}
              </a>
            ))}
            <p className="pt-1 text-[11px] text-ink-4">Full assumption metadata: config/assumptions.json, docs/PHYSICS.md, docs/HH09_TWIN_INPUTS.md.</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
