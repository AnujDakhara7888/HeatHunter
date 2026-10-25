import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import type { FixAction, RoomHealthView, RoomReport, RoomTechnical } from "../api/types";
import { causeLabel } from "../lib/diagnosis";
import { CAUSE, type CauseKey } from "../lib/rooms";
import { EvidenceBars } from "./EvidenceBars";
import { LineChart, type ChartSeries } from "./LineChart";

const gbp = (v: number) => `£${v < 100 ? v.toFixed(0) : Math.round(v).toLocaleString()}`;

type Props = {
  report: RoomReport | null;
  sel: RoomHealthView | undefined;
  technical: RoomTechnical | null;
  chartData: ChartSeries[] | null;
  cursor: number | null;
  onScrub: (t: number) => void;
  preview: CauseKey | null;
  setPreview: (fn: (p: CauseKey | null) => CauseKey | null) => void;
  busy: boolean;
  fix: (action: FixAction) => void;
};

/** One room's report: why, evidence night by night, cost, what to do and the repair buttons. */
export function RoomDetail({ report, sel, technical, chartData, cursor, onScrub, preview, setPreview, busy, fix }: Props) {
  const [showTech, setShowTech] = useState(false);
  const canFix = report && (report.status === "issue" || report.status === "issue_cause_unclear" || report.status === "still_an_issue");
  return (
    <AnimatePresence mode="wait">
      {report && sel && (
        <motion.section key={report.room_id + report.status} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <ChevronRight size={16} className="text-mute" />
            <h2 className="text-[19px] font-bold leading-tight tracking-tight">{report.headline}</h2>
          </div>
          {chartData && <LineChart data={chartData} height={170} cursor={cursor} onScrub={onScrub} />}
          {report.evidence_by_night.length > 0 && <EvidenceBars nights={report.evidence_by_night} />}
          {report.why.length > 0 && (
            <ul className="space-y-1 text-[12.5px] leading-snug text-[#d9dce3]">
              {report.why.map((w) => (
                <li key={w}>· {w}</li>
              ))}
            </ul>
          )}
          {(sel.likely_cause || canFix) && (
            <div className="flex flex-wrap gap-1.5 text-[11.5px]">
              <span className="text-dim">Show in 3D:</span>
              {(["draft", "envelope_conduction", "normal"] as CauseKey[]).map((c) => (
                <button key={c} onClick={() => setPreview((p) => (p === c ? null : c))} className={`rounded-full border px-2 py-0.5 ${preview === c ? "border-white/60 text-ink" : "border-line text-mute hover:text-ink"}`}>
                  {CAUSE[c].label}
                </button>
              ))}
            </div>
          )}
          {report.money && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Lost / year" value={gbp(report.money.annual_cost_gbp)} sub={`${Math.round(report.money.annual_energy_kwh)} kWh`} tone="hot" />
              <Stat label="Repair" value={report.money.repair_cost_gbp != null ? gbp(report.money.repair_cost_gbp) : "–"} sub="typical" />
              <Stat label="Pays back" value={report.money.payback_years != null ? `${report.money.payback_years.toFixed(1)} yr` : "–"} tone="ok" />
            </div>
          )}
          {report.what_to_do.length > 0 && (
            <div className="rounded-2xl border border-line bg-white/[0.02] p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Wrench size={14} /> What to do
              </div>
              <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-mute">
                {report.what_to_do.map((w) => (
                  <li key={w}>· {w}</li>
                ))}
              </ul>
            </div>
          )}
          {report.suggested_check && <div className="rounded-xl bg-[#16233b] px-3 py-2 text-[12.5px] text-[#cfe0ff]">{report.suggested_check}</div>}
          {canFix && (
            <div>
              <div className="mb-1.5 text-[11.5px] text-mute">You do the repair. Tell the app what you did, then keep watching:</div>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ["seal_leaks", "I sealed leaks"],
                  ["add_insulation", "I insulated"],
                  ["other", "Something else"],
                ] as [FixAction, string][]).map(([a, l]) => (
                  <button key={a} className={`btn !px-2 !py-2 !text-[12px] ${(sel.likely_cause === "draft" && a === "seal_leaks") || (sel.likely_cause === "envelope_conduction" && a === "add_insulation") ? "btn-hot" : "btn-ghost"}`} disabled={busy} onClick={() => fix(a)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {report.fix && (
            <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] text-mute">
              Repair reported: <b className="text-ink">{report.fix.action.replace("_", " ")}</b> · {report.fix.nights_since_fix} night{report.fix.nights_since_fix === 1 ? "" : "s"} since.
              {report.status === "verifying" && " Press Next night to check it."}
            </div>
          )}
          {technical && (
            <div>
              <button onClick={() => setShowTech((v) => !v)} className="text-[11.5px] text-mute hover:text-ink">
                {showTech ? "▾" : "▸"} The engine's math
              </button>
              {showTech && (
                <div className="mt-2 rounded-xl bg-black/30 p-3 font-mono text-[10.5px] leading-relaxed text-mute">
                  <div>nights judged {technical.nights_judged} · consecutive flagged nights {technical.consecutive_candidate_nights}</div>
                  {technical.extra_heat_loss_fraction != null && (
                    <div>
                      extra loss {(technical.extra_heat_loss_fraction * 100).toFixed(1)}% vs alarm {((technical.threshold_fraction ?? 0) * 100).toFixed(1)}%
                      {technical.cause_gap_bic != null && ` · cause gap ΔBIC ${technical.cause_gap_bic.toFixed(1)}`}
                    </div>
                  )}
                  <table className="mt-1.5 w-full">
                    <tbody>
                      {technical.fits.map((f) => (
                        <tr key={f.fault_type}>
                          <td style={{ color: CAUSE[f.fault_type as CauseKey]?.color }}>{causeLabel(f.fault_type)}</td>
                          <td className="text-right">×{f.fitted_multiplier.toFixed(2)}</td>
                          <td className="text-right">BIC {f.bic.toFixed(0)}</td>
                          <td className="text-right">±{f.residual_rmse_deg_c.toFixed(2)}°</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
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

