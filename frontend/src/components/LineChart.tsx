import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import type { Series } from "../api/types";
import { fmtTime, ms } from "../lib/rooms";

export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  series: Series;
  dashed?: boolean;
  width?: number;
  muted?: boolean;
};

type Props = {
  data: ChartSeries[];
  height?: number;
  unit?: string;
  cursor?: number | null;
  onScrub?: (t: number) => void;
  band?: { from: number; to: number; label: string } | null;
  legend?: boolean;
  domain?: [number, number];
  xDomain?: [number, number];
  compact?: boolean;
};



export function LineChart({ data, height = 220, unit = "°C", cursor, onScrub, band, legend = true, domain, xDomain, compact = false }: Props) {
  const M = compact ? { top: 4, right: 4, bottom: 4, left: 4 } : { top: 10, right: 64, bottom: 22, left: 34 };
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(520);
  const [hover, setHover] = useState<number | null>(null);
  const measured = useRef(false);

  const pts = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        pts: d.series.timestamps.map((t, i) => [ms(t), d.series.values[i]] as [number, number | null]),
      })),
    [data],
  );
  const all = pts.flatMap((p) => p.pts);
  const tx = xDomain ?? ([Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))] as [number, number]);
  const vals = all.map((p) => p[1]).filter((v): v is number => v != null);
  const ty = domain ?? ([Math.floor(Math.min(...vals) - 0.3), Math.ceil(Math.max(...vals) + 0.3)] as [number, number]);
  const x = scaleLinear().domain(tx).range([M.left, width - M.right]);
  const y = scaleLinear().domain(ty).range([height - M.bottom, M.top]);
  const path = line<[number, number | null]>()
    .defined((p) => p[1] != null)
    .x((p) => x(p[0]))
    .y((p) => y(p[1] as number));

  const at = (p: [number, number | null][], t: number) => {
    let best = p[0];
    for (const q of p) if (Math.abs(q[0] - t) < Math.abs(best[0] - t)) best = q;
    return best;
  };
  const hoverT = hover ?? null;
  const yTicks = y.ticks(4);
  const xTicks = x.ticks(5);

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const t = x.invert(((e.clientX - rect.left) / rect.width) * width);
    const clamped = Math.min(tx[1], Math.max(tx[0], t));
    setHover(clamped);
    if (e.buttons === 1) onScrub?.(clamped);
  };

  return (
    <div className="w-full">
      {legend && data.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
          {data.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1.5">
              <svg width="18" height="6">
                <line x1="0" x2="18" y1="3" y2="3" stroke={d.color} strokeWidth="2" strokeDasharray={d.dashed ? "4 3" : undefined} />
              </svg>
              {d.label}
            </span>
          ))}
        </div>
      )}
      <div
        className="relative"
        ref={(el) => {
          if (el && !measured.current) {
            measured.current = true;
            const ro = new ResizeObserver(([entry]) => setWidth(Math.max(compact ? 60 : 260, entry.contentRect.width)));
            ro.observe(el);
          }
        }}
      >
        <svg
          ref={ref}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          className="touch-none select-none"
          onPointerMove={onMove}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            onMove(e);
            const rect = ref.current!.getBoundingClientRect();
            onScrub?.(Math.min(tx[1], Math.max(tx[0], x.invert(((e.clientX - rect.left) / rect.width) * width))));
          }}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={data.map((d) => d.label).join(", ")}
        >
          {band && (
            <g>
              <rect x={x(band.from)} y={M.top} width={Math.max(0, x(band.to) - x(band.from))} height={height - M.top - M.bottom} fill="#7fd4ff12" />
              {!compact && <text x={x(band.from) + 6} y={M.top + 12} fill="#7fd4ff" fontSize="10" letterSpacing="0.08em">
                {band.label}
              </text>}
            </g>
          )}
          {!compact && yTicks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="#ffffff10" />
              <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fill="#626a7d" fontSize="10" className="num">
                {v}
                {unit === "°C" ? "°" : ""}
              </text>
            </g>
          ))}
          {!compact && xTicks.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" fill="#626a7d" fontSize="10" className="num">
              {fmtTime(t)}
            </text>
          ))}
          {pts.map((d) => (
            <motion.path
              key={d.id + d.series.timestamps.length}
              d={path(d.pts) ?? ""}
              fill="none"
              stroke={d.color}
              strokeWidth={d.width ?? 2}
              strokeDasharray={d.dashed ? "5 4" : undefined}
              strokeLinecap="round"
              opacity={d.muted ? 0.45 : 1}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
          {/* direct labels at line ends (<= 4 series) */}
          {!compact && pts.length <= 4 &&
            pts.map((d) => {
              const last = [...d.pts].reverse().find((p) => p[1] != null);
              if (!last) return null;
              return (
                <text key={d.id} x={x(last[0]) + 6} y={y(last[1] as number) + 3} fill="#c8ccd6" fontSize="10">
                  {d.label.length > 11 ? d.label.slice(0, 10) + "…" : d.label}
                </text>
              );
            })}
          {cursor != null && cursor >= tx[0] && cursor <= tx[1] && (
            <line x1={x(cursor)} x2={x(cursor)} y1={M.top} y2={height - M.bottom} stroke="#ffffff" strokeOpacity="0.55" />
          )}
          {hoverT != null && (
            <g pointerEvents="none">
              <line x1={x(hoverT)} x2={x(hoverT)} y1={M.top} y2={height - M.bottom} stroke="#ffffff" strokeOpacity="0.3" strokeDasharray="3 3" />
              {pts.map((d) => {
                const p = at(d.pts, hoverT);
                return p[1] == null ? null : (
                  <circle key={d.id} cx={x(p[0])} cy={y(p[1])} r="4" fill={d.color} stroke="#0d1017" strokeWidth="2" />
                );
              })}
            </g>
          )}
        </svg>
        {hoverT != null && (
          <div
            className="glass pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl px-3 py-2 text-[11px]"
            style={{ left: Math.min(Math.max(x(hoverT) / width, 0.05), 0.62) * 100 + "%" }}
          >
            <div className="mb-1 text-mute num">{fmtTime(hoverT)}</div>
            {pts.map((d) => {
              const p = at(d.pts, hoverT);
              return (
                <div key={d.id} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-mute">
                    <i className="inline-block h-0.5 w-3" style={{ background: d.color }} />
                    {d.label}
                  </span>
                  <span className="num font-medium">{p[1] == null ? "–" : `${p[1].toFixed(2)}${unit === "°C" ? "°" : " " + unit}`}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
