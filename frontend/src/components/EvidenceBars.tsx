import { motion } from "framer-motion";
import type { NightEvidence } from "../api/types";
import { CAUSE, type CauseKey } from "../lib/rooms";

/**
 * Night-by-night evidence: extra heat loss (%) against the alarm level the rule
 * used that night. Bars are coloured by the explanation leading that night; wind
 * is printed under each bar because windy nights separate leaks from walls.
 */
export function EvidenceBars({ nights }: { nights: NightEvidence[] }) {
  if (!nights.length) return null;
  const max = Math.max(...nights.map((n) => Math.max(n.extra_heat_loss_percent, n.threshold_percent)), 10) * 1.15;
  const H = 96;
  return (
    <div>
      <div className="flex h-[96px] items-end gap-1.5 border-b border-white/10">
        {nights.map((n, i) => {
          const c = CAUSE[n.leading_cause as CauseKey];
          const over = n.extra_heat_loss_percent > n.threshold_percent;
          return (
            <div key={n.night_id} className="group relative flex h-full flex-1 items-end justify-center">
              <div className="absolute inset-x-0 border-t border-dashed border-white/50" style={{ bottom: `${(n.threshold_percent / max) * H}px` }} />
              <motion.div
                className="w-full max-w-7 rounded-t-[4px]"
                style={{ background: over ? c.color : "#4a5162" }}
                initial={{ height: 0 }}
                animate={{ height: `${(Math.max(0, n.extra_heat_loss_percent) / max) * H}px` }}
                transition={{ delay: i * 0.06, duration: 0.6 }}
              />
              <div className="glass pointer-events-none absolute bottom-full z-10 mb-1 hidden w-40 rounded-lg px-2 py-1.5 text-[10.5px] group-hover:block">
                <div className="num font-semibold">{n.night_id.replace("hh09-night-", "")}</div>
                <div className="num">+{n.extra_heat_loss_percent.toFixed(1)}% vs alarm {n.threshold_percent.toFixed(1)}%</div>
                <div>leading: {c.label.toLowerCase()}</div>
                <div className="num text-mute">wind {n.mean_wind_m_s.toFixed(1)} m/s</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-[9.5px] text-dim">
        {nights.map((n) => (
          <div key={n.night_id} className="num flex-1 text-center">
            {n.mean_wind_m_s.toFixed(1)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-dim">
        <span>bars: extra heat loss each night · dashed: alarm level</span>
        <span>wind m/s</span>
      </div>
    </div>
  );
}
