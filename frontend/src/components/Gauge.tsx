import { motion } from "framer-motion";
import { STATUS_COPY } from "../lib/diagnosis";

/** Confidence dial: how far the winning explanation is ahead (BIC gap vs. the engine's own threshold). */
export function Gauge({ status, gap, threshold }: { status: string; gap: number | null; threshold: number | null }) {
  const copy = STATUS_COPY[status] ?? STATUS_COPY.unexplained;
  const k = gap != null && threshold ? Math.min(1, gap / (threshold * 2)) : status === "confident" ? 1 : 0.15;
  const r = 46;
  const c = Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg width="120" height="70" viewBox="0 0 120 70" aria-hidden>
        <path d="M14 62 A46 46 0 0 1 106 62" stroke="#ffffff14" strokeWidth="10" fill="none" strokeLinecap="round" />
        {threshold != null && (
          <line x1="60" y1="10" x2="60" y2="22" stroke="#ffffff55" strokeWidth="2" transform="rotate(0 60 62)" />
        )}
        <motion.path
          d="M14 62 A46 46 0 0 1 106 62"
          stroke={copy.color}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - k) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div>
        <div className="text-xl font-bold tracking-tight" style={{ color: copy.color }}>
          {copy.label}
        </div>
        <div className="text-[12.5px] text-mute">{copy.line}</div>
        {gap != null && (
          <div className="mt-0.5 text-[11px] text-dim num">
            lead {gap.toFixed(0)} · needs {threshold?.toFixed(0) ?? "–"} to be sure
          </div>
        )}
      </div>
    </div>
  );
}
