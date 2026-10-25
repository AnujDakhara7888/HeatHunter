import { motion } from "framer-motion";
import type { HomeAnalysis } from "../api/types";
import { bicGap, causeLabel, fitsFor } from "../lib/diagnosis";
import { roomColor } from "../lib/rooms";
import { useScene } from "../store/scene";
import { Gauge } from "./Gauge";
import { Suspects } from "./Suspects";

const money = (usd: number) => `$${usd < 100 ? usd.toFixed(0) : Math.round(usd).toLocaleString()}`;

/** Results of the engine run on a home's own readings (screening; no fault labels exist). */
export function Screening({ result, names }: { result: HomeAnalysis; names: Record<string, string> }) {
  const set = useScene((s) => s.set);
  const night = result.nights[0];
  const ranked = [...result.rooms].sort((a, b) => b.anomaly_score - a.anomaly_score);
  const max = Math.max(...ranked.map((r) => r.anomaly_score), 1);
  const top = result.flagged_room_id ?? ranked[0]?.room_id;
  const lead = result.ranked_causes[0];
  const m = result.money_estimate;
  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow">Screening result</div>
        <h3 className="mt-1 text-[22px] font-bold leading-tight tracking-tight">
          {result.flagged_room_id && lead && (result.status === "confident" || result.status === "ambiguous") ? (
            <>
              {names[result.flagged_room_id] ?? result.flagged_room_id} loses heat <span className="text-warm">{lead.fitted_multiplier.toFixed(1)}×</span> faster
              than expected{result.status === "confident" ? `, most likely ${causeLabel(lead.fault_type).toLowerCase()}.` : "."}
            </>
          ) : result.status === "no_fault" ? (
            "Every room cools the way the model expects."
          ) : (
            "The model can't explain this night well enough to call a fault."
          )}
        </h3>
      </div>
      <Gauge status={result.status} gap={bicGap({ ranked_causes: result.ranked_causes } as never)} threshold={null} />
      <div>
        <div className="mb-1.5 flex justify-between text-[11px] text-mute">
          <span>How unusual each room is</span>
          <span className="num">{result.rooms.length * 3} fits · {Math.round(result.elapsed_ms)} ms</span>
        </div>
        <div className="space-y-1.5">
          {ranked.map((r, i) => (
            <button key={r.room_id} onClick={() => set({ focusRoom: r.room_id })} className="flex w-full items-center gap-2 text-left text-[12px]">
              <span className="w-24 truncate text-mute">{names[r.room_id] ?? r.room_id}</span>
              <div className="h-2 flex-1 rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: r.room_id === result.flagged_room_id ? "#ff6a3d" : roomColor(r.room_id) }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, (Math.max(0, r.anomaly_score) / max) * 100)}%` }}
                  transition={{ delay: 0.08 * i, duration: 0.7 }}
                />
              </div>
              <span className="w-16 text-right num text-dim">±{Math.min(...r.fits.map((f) => f.residual_rmse_deg_c)).toFixed(2)}°</span>
            </button>
          ))}
        </div>
        <div className="mt-1 text-[10.5px] text-dim">± = how closely the best explanation tracks the sensor.</div>
      </div>
      {top && night.room_temperature_series[top] && (
        <div>
          <div className="mb-1.5 text-[11px] text-mute">Three suspects for {names[top] ?? top}</div>
          <Suspects
            fits={fitsFor(result.rooms.find((r) => r.room_id === top))}
            observed={night.room_temperature_series[top]}
            nightId={night.night_id}
            leading={lead?.fault_type ?? null}
          />
        </div>
      )}
      {m && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Lost / year", money(m.annual_cost_estimate_usd), "text-hot"],
            ["Repair", money(m.repair_cost_usd), ""],
            ["Pays back", m.simple_payback_years ? `${m.simple_payback_years.toFixed(1)} yr` : "–", "text-ok"],
          ].map(([l, v, c]) => (
            <div key={l} className="rounded-xl bg-white/[0.04] px-3 py-2">
              <div className="text-[10.5px] text-mute">{l}</div>
              <div className={`num text-[18px] font-bold ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="space-y-1 text-[11px] leading-snug text-dim">
        {result.uncertainty.slice(0, 3).map((u) => (
          <li key={u}>· {u}</li>
        ))}
      </ul>
    </div>
  );
}
