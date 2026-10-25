import { motion } from "framer-motion";
import type { FitCurve, Series } from "../api/types";
import { CAUSE, type CauseKey } from "../lib/rooms";
import { LineChart } from "./LineChart";

type Props = {
  fits: Record<string, FitCurve>;
  observed: Series;
  nightId: string;
  leading?: string | null;
  ruledOut?: string[];
  band?: { from: number; to: number; label: string } | null;
  /** Explanation currently previewed in 3D, if any. */
  selected?: string | null;
  onSelect?: (cause: CauseKey) => void;
};

/** The three competing explanations, each drawn against what was measured. */
export function Suspects({ fits, observed, nightId, leading, ruledOut = [], band, selected, onSelect }: Props) {
  const order: CauseKey[] = ["draft", "envelope_conduction", "normal"];
  const rmses = order.map((c) => fits[c]?.residual_rmse_deg_c ?? 1);
  const worst = Math.max(...rmses, 0.3);
  return (
    <div className="grid grid-cols-3 gap-2">
      {order.map((cause, i) => {
        const fit = fits[cause];
        if (!fit) return null;
        const meta = CAUSE[cause];
        const win = leading === cause;
        const out = ruledOut.includes(cause);
        const curve = fit.predicted[nightId];
        const quality = 1 - fit.residual_rmse_deg_c / worst;
        return (
          <motion.button
            type="button"
            key={cause}
            onClick={() => onSelect?.(cause)}
            title={onSelect ? `Show "${meta.label}" in 3D` : undefined}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: out ? 0.5 : 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12 }}
            className={`rounded-2xl border p-2.5 text-left transition ${onSelect ? "cursor-pointer hover:border-white/30" : "cursor-default"} ${win ? "border-[color:var(--c)] bg-[color:var(--c)]/10" : "border-line bg-white/[0.02]"} ${selected === cause ? "ring-2 ring-white/70" : ""}`}
            style={{ ["--c" as string]: meta.color }}
          >
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-semibold" style={{ color: win ? meta.color : undefined }}>
                {meta.icon} {meta.short}
              </span>
              <span className="text-[10px] text-dim">{out ? "ruled out" : win ? "best fit" : ""}</span>
            </div>
            {curve && (
              <LineChart
                height={72}
                compact
                legend={false}
                band={band}
                data={[
                  { id: "m", label: "Measured", color: "#f2f3f5", series: observed, width: 1.5 },
                  { id: "f", label: meta.short, color: meta.color, series: curve, dashed: true, width: 2 },
                ]}
              />
            )}
            <div className="mt-1 flex items-center justify-between text-[10.5px] text-mute">
              <span className="num">±{fit.residual_rmse_deg_c.toFixed(2)}°C</span>
              {cause !== "normal" && <span className="num">×{fit.fitted_multiplier.toFixed(2)}</span>}
            </div>
            <div className="mt-1 h-1 rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{ background: meta.color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, quality * 100)}%` }}
                transition={{ delay: 0.4 + i * 0.12, duration: 0.8 }}
              />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
