import { useState } from "react";
import type { DiagnosisStatus } from "../../lib/api";
import { fmt } from "../../lib/format";
import { PLAN_ROOMS, PLAN_UNMODELED, PLAN_WINDOWS } from "../../lib/geometry";
import { TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";

const ROOMS = PLAN_ROOMS;
const UNMODELED = PLAN_UNMODELED;
const WINDOWS = PLAN_WINDOWS;

export interface RoomReading {
  temp: number | null;
  drop: number | null;
}

/** Cold = more saturated icy blue; warm = muted slate. Single-hue sequential. */
export function thermalFill(temp: number | null, lo: number, hi: number): string {
  if (temp === null) return "rgba(71,82,98,0.18)";
  const t = hi > lo ? Math.min(1, Math.max(0, (hi - temp) / (hi - lo))) : 0.5;
  const light = 22 + t * 20;
  const chroma = 0.025 + t * 0.11;
  return `oklch(${light}% ${chroma} 245 / ${0.5 + t * 0.4})`;
}

export function TwinHouse({
  readings,
  range,
  selected,
  onSelect,
  flagged,
  status,
  truthRoom,
  repairedRoom,
  fanOn,
}: {
  readings: Partial<Record<TwinRoomId, RoomReading>>;
  range: [number, number];
  selected: TwinRoomId | null;
  onSelect: (id: TwinRoomId) => void;
  flagged: string | null;
  status: DiagnosisStatus | null;
  truthRoom: string | null;
  repairedRoom: string | null;
  fanOn: boolean;
}) {
  const [hover, setHover] = useState<TwinRoomId | null>(null);
  const alert = status === "confident" ? "var(--color-crit)" : "var(--color-warn)";

  return (
    <div className="relative">
      <svg viewBox="-70 -70 778 904" className="mx-auto block h-auto w-full max-w-[520px]" role="group" aria-label="HH09 digital-twin schematic">
        <defs>
          <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="10" stroke="#1f2935" strokeWidth="3" />
          </pattern>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Compass/scale ticks */}
        <g className="font-mono" fontSize="13" fill="#475262">
          <line x1="0" y1="-38" x2="100" y2="-38" stroke="#475262" strokeWidth="1.5" />
          <line x1="0" y1="-44" x2="0" y2="-32" stroke="#475262" strokeWidth="1.5" />
          <line x1="100" y1="-44" x2="100" y2="-32" stroke="#475262" strokeWidth="1.5" />
          <text x="108" y="-34">1 m</text>
          <text x="638" y="-34" textAnchor="end">HH09 · GROUND FLOOR · SCHEMATIC</text>
        </g>

        {UNMODELED.map(({ label, rect }) => (
          <g key={label}>
            <rect {...rect} width={rect.w} height={rect.h} fill="url(#hatch)" stroke="#1f2935" strokeWidth="2" />
            <text
              x={rect.x + rect.w / 2}
              y={rect.y + rect.h / 2}
              textAnchor="middle"
              className="font-mono"
              fontSize={label === "Bathroom" ? 15 : 11}
              fill="#475262"
              letterSpacing="1.5"
            >
              {label.toUpperCase()}
            </text>
            {label === "Bathroom" && (
              <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 20} textAnchor="middle" fontSize="11" fill="#3a4554" className="font-mono">
                NOT IN TWIN
              </text>
            )}
          </g>
        ))}

        {TWIN_ORDER.map((id) => {
          const r = ROOMS[id];
          const meta = TWIN_ROOMS[id];
          const reading = readings[id];
          const isFlagged = flagged === id;
          const isSelected = selected === id;
          const isHover = hover === id;
          const small = r.w < 150;
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`${meta.name}${reading?.temp != null ? `, ${fmt(reading.temp)} degrees` : ""}${isFlagged ? ", flagged" : ""}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(id)}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
              className="cursor-pointer outline-none"
            >
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={thermalFill(reading?.temp ?? null, range[0], range[1])}
                style={{ transition: "fill 0.35s ease" }}
              />
              {isFlagged && (
                <>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={alert} opacity={0.12} />
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={alert} className="animate-pulse-ring" />
                  <rect x={r.x + 3} y={r.y + 3} width={r.w - 6} height={r.h - 6} fill="none" stroke={alert} strokeWidth="3" filter="url(#glow)" />
                </>
              )}
              {(isSelected || isHover) && (
                <rect
                  x={r.x + 7}
                  y={r.y + 7}
                  width={r.w - 14}
                  height={r.h - 14}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  strokeDasharray={isSelected ? undefined : "6 5"}
                  opacity={isSelected ? 0.95 : 0.6}
                />
              )}
              {truthRoom === id && (
                <g>
                  <rect x={r.x + 14} y={r.y + 14} width={r.w - 28} height={r.h - 28} fill="none" stroke="var(--color-prov-truth)" strokeWidth="2" strokeDasharray="2 6" />
                  <text x={r.x + r.w - 20} y={r.y + r.h - 22} textAnchor="end" fontSize="11" fill="var(--color-prov-truth)" className="font-mono" letterSpacing="1.5">
                    TRUE FAULT
                  </text>
                </g>
              )}

              <circle cx={r.x + 20} cy={r.y + 22} r={5} fill={meta.color} />
              <text x={r.x + 32} y={r.y + 27} fontSize={small ? 13 : 15} fill="#e6edf3" fontWeight="600" letterSpacing="0.3">
                {small ? meta.short : meta.name}
              </text>
              <text
                x={cx}
                y={cy + (small ? 0 : 6)}
                textAnchor="middle"
                className="font-mono"
                fontSize={small ? 22 : 38}
                fontWeight="500"
                fill="#f4f8fb"
              >
                {reading?.temp != null ? fmt(reading.temp) : "—"}
                <tspan fontSize={small ? 12 : 17} fill="#a7b3c2">
                  °C
                </tspan>
              </text>
              {reading?.drop != null && (
                <text x={cx} y={cy + (small ? 22 : 34)} textAnchor="middle" className="font-mono" fontSize={small ? 10.5 : 12.5} fill="#8fa0b3">
                  Δ {reading.drop >= 0 ? "−" : "+"}
                  {fmt(Math.abs(reading.drop), 2)}°C
                </text>
              )}
              {isFlagged && (
                <g transform={`translate(${small ? r.x + 6 : r.x + r.w - 128}, ${small ? r.y + r.h - 40 : r.y + 12})`}>
                  <rect width={small ? 102 : 116} height="22" rx="3" fill="#0b0f14" stroke={alert} />
                  <text x={small ? 51 : 58} y="15" textAnchor="middle" fontSize="11" fill={alert} className="font-mono" letterSpacing="1.4">
                    ▲ ANOMALY
                  </text>
                </g>
              )}
              {repairedRoom === id && (
                <g transform={`translate(${r.x + 12}, ${r.y + r.h - 34})`}>
                  <rect width="92" height="22" rx="3" fill="#0b0f14" stroke="var(--color-ok)" />
                  <text x="46" y="15" textAnchor="middle" fontSize="11" fill="var(--color-ok)" className="font-mono" letterSpacing="1.4">
                    ✓ REPAIRED
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Walls */}
        <g fill="none" stroke="#c9d4e0" strokeLinejoin="miter">
          {TWIN_ORDER.map((id) => {
            const r = ROOMS[id];
            return <rect key={id} x={r.x} y={r.y} width={r.w} height={r.h} strokeWidth="5" opacity="0.85" pointerEvents="none" />;
          })}
          {UNMODELED.map(({ label, rect }) => (
            <rect key={label} x={rect.x} y={rect.y} width={rect.w} height={rect.h} strokeWidth="3" opacity="0.25" pointerEvents="none" />
          ))}
        </g>
        <g stroke="var(--color-accent)" strokeWidth="5" strokeLinecap="round" opacity="0.9" pointerEvents="none">
          {WINDOWS.map((w, i) => (
            <line key={i} {...w} />
          ))}
        </g>

        {fanOn && (
          <g transform="translate(470, 700)" className="font-mono">
            <rect width="168" height="44" rx="4" fill="#07141a" stroke="var(--color-accent)" />
            <text x="12" y="18" fontSize="11" fill="var(--color-accent)" letterSpacing="1.4">
              E1 · EXHAUST FAN ON
            </text>
            <text x="12" y="34" fontSize="10.5" fill="#8fa0b3">
              simulated depressurization
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-8 rounded-sm" style={{ background: "linear-gradient(90deg, oklch(24% 0.04 245), oklch(46% 0.16 245))" }} />
          warmer → colder (vs other rooms, this moment)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[3px] w-5 rounded bg-accent" /> documented window
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border border-[#1f2935]" style={{ background: "repeating-linear-gradient(45deg,#1f2935 0 2px,transparent 2px 5px)" }} />
          not modelled
        </span>
        <span>Δ = drop since first reading</span>
      </div>
    </div>
  );
}
