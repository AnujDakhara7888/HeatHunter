import { Thermometer, Wind } from "lucide-react";
import { fmt } from "../lib/format";

const MPH_PER_MS = 2.23694;

/** Beaufort scale names (WMO), by mean wind speed in m/s. */
export function beaufort(ms: number): string {
  if (ms < 0.3) return "Calm";
  if (ms < 1.6) return "Light air";
  if (ms < 3.4) return "Light breeze";
  if (ms < 5.5) return "Gentle breeze";
  if (ms < 8.0) return "Moderate breeze";
  if (ms < 10.8) return "Fresh breeze";
  if (ms < 13.9) return "Strong breeze";
  return "Near gale or stronger";
}

function at(values: (number | null)[], i: number): number | null {
  for (let k = Math.min(i, values.length - 1); k >= 0; k--) if (values[k] != null) return values[k];
  return null;
}

function Sparkline({ values, index, color, min }: { values: (number | null)[]; index: number; color: string; min?: number }) {
  const W = 200;
  const H = 34;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const lo = Math.min(min ?? Infinity, ...nums);
  const hi = Math.max(...nums);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - 6);
  let d = "";
  values.forEach((v, i) => {
    if (v == null) return;
    d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const cur = at(values, index);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {cur != null && (
        <>
          <line x1={x(index)} x2={x(index)} y1={0} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={x(index)} cy={y(cur)} r={2.6} fill="#fff" />
        </>
      )}
    </svg>
  );
}

/** Outside temperature and wind at the current playback time, with the whole period as sparklines. */
export function WeatherCard({
  temps,
  winds,
  index,
  period = "tonight",
  className = "",
}: {
  temps: (number | null)[];
  winds: (number | null)[];
  index: number;
  period?: string;
  className?: string;
}) {
  const t = at(temps, index);
  const w = at(winds, index);
  return (
    <div className={`rounded-2xl border border-white/15 bg-black/55 p-3.5 text-white backdrop-blur-md ${className}`}>
      <div className="mb-2 text-[12px] font-medium text-white/55">Outside {period}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-white/70">
            <Thermometer size={13} className="text-sky-300" /> Temperature
          </div>
          <div className="mt-0.5 text-[20px] font-semibold tabular-nums leading-tight">{t != null ? `${fmt(t, 1)}°C` : "—"}</div>
          <Sparkline values={temps} index={index} color="#7dd3fc" />
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-white/70">
            <Wind size={13} className="text-teal-300" /> Wind
          </div>
          <div className="mt-0.5 text-[20px] font-semibold tabular-nums leading-tight">
            {w != null ? (
              <>
                {fmt(w, 1)} <span className="text-[12.5px] font-normal text-white/60">m/s · {fmt(w * MPH_PER_MS, 0)} mph</span>
              </>
            ) : (
              "—"
            )}
          </div>
          <Sparkline values={winds} index={index} color="#5eead4" min={0} />
        </div>
      </div>
      {w != null && <div className="mt-1 text-[12px] text-white/55">{beaufort(w)} · wind pushes cold air through any gaps</div>}
    </div>
  );
}
