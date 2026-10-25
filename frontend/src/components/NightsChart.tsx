import { scaleBand, scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { motion } from "framer-motion";
import { useRef, useState, type ReactNode } from "react";

export type NightSeries = {
  id: string;
  label: string;
  color: string;
  values: (number | null)[]; // index 0 = night 1
  kind?: "line" | "bar";
  dashed?: boolean;
  /** per-bar colour override (bars only) */
  barColors?: (string | null)[];
};

type Props = {
  nights: number;
  series: NightSeries[];
  height?: number;
  unit?: string;
  format?: (v: number) => string;
  /** fill the gap where series[0] is above series[1] (e.g. extra loss above the alarm level) */
  overFill?: string;
  /** horizontal reference line */
  ref_?: { value: number; label: string };
  /** vertical markers at given nights */
  marks?: { night: number; label: string; color?: string }[];
  current?: number | null;
  onPick?: (night: number) => void;
  domain?: [number, number];
  xLabel?: (night: number) => string;
  tooltipExtra?: (night: number) => ReactNode;
  legend?: boolean;
  zero?: boolean;
};

/** A chart with one slot per night (1..n): lines and/or bars on one y-axis, with a hover tooltip. */
export function NightsChart({ nights, series, height = 180, unit = "", format = (v) => v.toFixed(1), overFill, ref_, marks = [], current, onPick, domain, xLabel = (n) => String(n), tooltipExtra, legend = true, zero = false }: Props) {
  const M = { top: 14, right: 18, bottom: 24, left: 40 };
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const observed = useRef(false);

  const xs = Array.from({ length: nights }, (_, i) => i + 1);
  const x = scaleBand<number>().domain(xs).range([M.left, width - M.right]).padding(0.28);
  const cx = (n: number) => (x(n) ?? 0) + x.bandwidth() / 2;
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (ref_) vals.push(ref_.value);
  if (zero || series.some((s) => s.kind === "bar")) vals.push(0);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const pad = (hi - lo || 1) * 0.12;
  const y = scaleLinear()
    .domain(domain ?? [lo < 0 ? lo - pad : lo - (zero ? 0 : pad * 0.5), hi + pad])
    .nice()
    .range([height - M.bottom, M.top]);
  const path = line<[number, number | null]>()
    .defined((p) => p[1] != null)
    .x((p) => cx(p[0]))
    .y((p) => y(p[1] as number));
  const bars = series.filter((s) => s.kind === "bar");
  const bw = x.bandwidth() / Math.max(1, bars.length);

  let fill: string | null = null;
  if (overFill && series.length >= 2) {
    const [a, b] = series;
    const segs: string[] = [];
    xs.forEach((n, i) => {
      const va = a.values[i];
      const vb = b.values[i];
      if (va == null || vb == null || va <= vb) return;
      const w = Math.max(6, x.bandwidth() * 0.9);
      segs.push(`M${cx(n) - w / 2},${y(vb)}L${cx(n) + w / 2},${y(vb)}L${cx(n) + w / 2},${y(va)}L${cx(n) - w / 2},${y(va)}Z`);
    });
    fill = segs.join("");
  }

  const pick = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    let best = 1;
    for (const n of xs) if (Math.abs(cx(n) - px) < Math.abs(cx(best) - px)) best = n;
    return best;
  };
  const fmt = (v: number | null) => (v == null ? "–" : `${format(v)}${unit}`);
  const showEvery = Math.ceil(nights / Math.max(1, Math.floor((width - 60) / 34)));

  return (
    <div className="w-full">
      {legend && series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              {s.kind === "bar" ? (
                <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              ) : (
                <svg width="18" height="6">
                  <line x1="0" x2="18" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
                </svg>
              )}
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={(el) => {
          box.current = el;
          if (el && !observed.current) {
            observed.current = true;
            new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width))).observe(el);
          }
        }}
        className="relative"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className={`select-none ${onPick ? "cursor-pointer" : ""}`}
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onPick?.(pick(e))}
          role="img"
          aria-label={series.map((s) => s.label).join(", ")}
        >
          {y.ticks(4).map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#ffffff30" : "#ffffff0d"} />
              <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fill="#626a7d" fontSize="10" className="num">
                {format(v)}
              </text>
            </g>
          ))}
          {xs.map((n) =>
            (n - 1) % showEvery === 0 || n === nights ? (
              <text key={n} x={cx(n)} y={height - 7} textAnchor="middle" fill={n === current ? "#f2f3f5" : "#626a7d"} fontSize="10" className="num">
                {xLabel(n)}
              </text>
            ) : null,
          )}
          {hover != null && <rect x={(x(hover) ?? 0) - x.step() * x.paddingInner() * 0.5} y={M.top} width={x.step()} height={height - M.top - M.bottom} fill="#ffffff08" />}
          {current != null && current <= nights && <rect x={(x(current) ?? 0) - 3} y={M.top} width={x.bandwidth() + 6} height={height - M.top - M.bottom} rx={4} fill="#ffffff0a" stroke="#ffffff22" />}
          {fill && <path d={fill} fill={overFill} opacity={0.22} />}
          {bars.map((s, k) =>
            s.values.map((v, i) =>
              v == null ? null : (
                <motion.rect
                  key={s.id + i}
                  x={(x(i + 1) ?? 0) + k * bw + 1}
                  width={Math.max(2, bw - 2)}
                  rx={Math.min(4, bw / 3)}
                  fill={s.barColors?.[i] ?? s.color}
                  initial={{ y: y(0), height: 0 }}
                  animate={{ y: Math.min(y(v), y(0)), height: Math.abs(y(0) - y(v)) }}
                  transition={{ delay: i * 0.03, duration: 0.5 }}
                />
              ),
            ),
          )}
          {ref_ && (
            <g>
              <line x1={M.left} x2={width - M.right} y1={y(ref_.value)} y2={y(ref_.value)} stroke="#f2f3f5" strokeOpacity="0.5" strokeDasharray="4 4" />
              <text x={width - M.right} y={y(ref_.value) - 5} textAnchor="end" fill="#9aa1b2" fontSize="10">
                {ref_.label}
              </text>
            </g>
          )}
          {series
            .filter((s) => s.kind !== "bar")
            .map((s) => (
              <g key={s.id}>
                <motion.path
                  d={path(s.values.map((v, i) => [i + 1, v] as [number, number | null])) ?? ""}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                />
                {!s.dashed &&
                  s.values.map((v, i) =>
                    v == null ? null : <circle key={i} cx={cx(i + 1)} cy={y(v)} r={hover === i + 1 ? 5 : 3.5} fill={s.color} stroke="#0d1017" strokeWidth="2" />,
                  )}
              </g>
            ))}
          {marks.map((m) => (
            <g key={m.label + m.night} pointerEvents="none">
              <line x1={cx(m.night)} x2={cx(m.night)} y1={M.top} y2={height - M.bottom} stroke={m.color ?? "#f2f3f5"} strokeOpacity="0.6" strokeDasharray="2 3" />
              <text x={cx(m.night) + 4} y={M.top + 8} fill={m.color ?? "#c8ccd6"} fontSize="10" fontWeight={600}>
                {m.label}
              </text>
            </g>
          ))}
        </svg>
        {hover != null && (
          <div className="glass pointer-events-none absolute top-0 z-10 min-w-40 rounded-xl px-3 py-2 text-[11px]" style={{ left: `${Math.min(Math.max(cx(hover) / width, 0.04), 0.66) * 100}%` }}>
            <div className="mb-1 font-semibold">Night {xLabel(hover)}</div>
            {series.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-mute">
                  <i className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="num font-medium">{fmt(s.values[hover - 1] ?? null)}</span>
              </div>
            ))}
            {tooltipExtra?.(hover)}
          </div>
        )}
      </div>
    </div>
  );
}
