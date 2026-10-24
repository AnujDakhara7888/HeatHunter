import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Series } from "../lib/api";
import { fmt, utcDate, utcTime } from "../lib/format";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  series: Series;
  dashed?: boolean;
  dotted?: boolean;
  emphasis?: "focus" | "dim" | "normal";
  endLabel?: boolean;
}

type Row = { t: number } & Record<string, number | null>;

function mergeRows(series: ChartSeries[]): Row[] {
  const map = new Map<number, Row>();
  for (const s of series) {
    s.series.timestamps.forEach((ts, i) => {
      const t = Date.parse(ts);
      const row = map.get(t) ?? ({ t } as Row);
      row[s.key] = s.series.values[i] ?? null;
      map.set(t, row);
    });
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function multiDay(rows: Row[]): boolean {
  return rows.length > 1 && rows[rows.length - 1].t - rows[0].t > 26 * 3600 * 1000;
}

/** UTC midnights inside the data range, so multi-day axes show one tick per day. */
function dayTicks(rows: Row[]): number[] | undefined {
  if (!multiDay(rows)) return undefined;
  const day = 86400000;
  const ticks: number[] = [];
  for (let t = Math.ceil(rows[0].t / day) * day; t <= rows[rows.length - 1].t; t += day) ticks.push(t);
  return ticks;
}

function TooltipBody({
  active,
  payload,
  label,
  series,
  unit,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | null }[];
  label?: number;
  series: ChartSeries[];
  unit: string;
}) {
  if (!active || !payload?.length || label === undefined) return null;
  const iso = new Date(label).toISOString();
  return (
    <div className="min-w-[180px] rounded border border-line-strong bg-[#0b1017]/95 px-3 py-2 shadow-2xl backdrop-blur">
      <div className="micro mb-1.5 text-ink-2">
        {utcDate(iso)} · {utcTime(iso)} UTC
      </div>
      {series.map((s) => {
        const value = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-[1px] text-[11.5px]">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span
                className="inline-block h-[2px] w-3"
                style={{
                  background: s.dashed ? `repeating-linear-gradient(90deg, ${s.color} 0 3px, transparent 3px 5px)` : s.color,
                }}
              />
              {s.label}
            </span>
            <span className="num text-ink">{value == null ? "no reading" : `${fmt(value, 2)} ${unit}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TelemetryChart({
  series,
  unit = "°C",
  height = 280,
  fan,
  cursor,
  yDomain,
  hidden,
}: {
  series: ChartSeries[];
  unit?: string;
  height?: number;
  fan?: { start: string; end: string } | null;
  cursor?: string | null;
  yDomain?: [number, number];
  hidden?: Set<string>;
}) {
  const visible = series.filter((s) => !hidden?.has(s.key));
  const rows = useMemo(() => mergeRows(series), [series]);
  const days = multiDay(rows);
  const lastIndex = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of series) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][s.key] != null) {
          out[s.key] = i;
          break;
        }
      }
    }
    return out;
  }, [rows, series]);

  if (!rows.length) return null;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 72, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={dayTicks(rows)}
            tickFormatter={(t: number) => {
              const iso = new Date(t).toISOString();
              return days ? utcDate(iso).slice(0, 6) : utcTime(iso);
            }}
            tickLine={false}
            axisLine={{ stroke: "#2a3646" }}
            minTickGap={36}
          />
          <YAxis
            domain={yDomain ?? ["auto", "auto"]}
            tickFormatter={(v: number) => `${fmt(v, 0)}`}
            tickLine={false}
            axisLine={false}
            width={44}
            label={{ value: unit, position: "insideTopLeft", offset: 12, fill: "#6b7889", fontSize: 10 }}
          />
          {fan && (
            <ReferenceArea
              x1={Date.parse(fan.start)}
              x2={Date.parse(fan.end)}
              fill="#22d3ee"
              fillOpacity={0.07}
              stroke="#22d3ee"
              strokeOpacity={0.35}
              strokeDasharray="3 4"
              label={{ value: "FAN ON", position: "insideTopLeft", fill: "#22d3ee", fontSize: 10 }}
            />
          )}
          {cursor && <ReferenceLine x={Date.parse(cursor)} stroke="#e6edf3" strokeOpacity={0.5} strokeDasharray="2 3" />}
          <Tooltip
            content={(props) => <TooltipBody {...(props as object)} series={visible} unit={unit} />}
            cursor={{ stroke: "#3a4a5e", strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {visible.map((s) => {
            const width = s.emphasis === "focus" ? 2.6 : s.emphasis === "dim" ? 1.2 : 1.8;
            const opacity = s.emphasis === "dim" ? 0.45 : 1;
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={width}
                strokeOpacity={opacity}
                strokeDasharray={s.dashed ? "5 4" : s.dotted ? "1.5 3" : undefined}
                strokeLinecap={s.dotted ? "round" : undefined}
                dot={(props: { index?: number; cx?: number; cy?: number }) => {
                  if (!s.endLabel || props.index !== lastIndex[s.key] || props.cx == null || props.cy == null)
                    return <g key={`${s.key}-${props.index}`} />;
                  return (
                    <g key={`${s.key}-end`}>
                      <circle cx={props.cx} cy={props.cy} r={3.5} fill={s.color} stroke="#0d1117" strokeWidth={2} />
                      <text x={props.cx + 8} y={props.cy + 3.5} fontSize={10.5} fill="#a7b3c2" className="font-mono">
                        {s.label.length > 9 ? s.label.slice(0, 8) + "…" : s.label}
                      </text>
                    </g>
                  );
                }}
                activeDot={{ r: 4, stroke: "#0d1117", strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WindChart({ series, height = 84, fan }: { series: Series; height?: number; fan?: { start: string; end: string } | null }) {
  const rows = useMemo(
    () => series.timestamps.map((ts, i) => ({ t: Date.parse(ts), wind: series.values[i] ?? null })),
    [series],
  );
  const days = multiDay(rows as Row[]);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 72, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="windFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b98a9" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b98a9" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide={!days} ticks={dayTicks(rows as Row[])} tickFormatter={(t: number) => utcDate(new Date(t).toISOString()).slice(0, 6)} tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={44} tickCount={3} tickFormatter={(v: number) => fmt(v, 0)} />
          {fan && <ReferenceArea x1={Date.parse(fan.start)} x2={Date.parse(fan.end)} fill="#22d3ee" fillOpacity={0.07} />}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "#3a4a5e" }}
            content={({ active, payload, label }) =>
              active && payload?.length && label !== undefined ? (
                <div className="rounded border border-line-strong bg-[#0b1017]/95 px-2.5 py-1.5 text-[11px]">
                  <span className="micro mr-2">{utcTime(new Date(label as number).toISOString())} UTC</span>
                  <span className="num">wind {fmt(payload[0].value as number, 1)} m/s</span>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="wind" stroke="#8b98a9" strokeWidth={1.5} fill="url(#windFill)" isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SeriesLegend({
  series,
  hidden,
  onToggle,
  focus,
  onHover,
}: {
  series: { key: string; label: string; color: string; dashed?: boolean; dotted?: boolean }[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
  focus?: string | null;
  onHover?: (key: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Chart series">
      {series.map((s) => {
        const off = hidden?.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle?.(s.key)}
            onMouseEnter={() => onHover?.(s.key)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(s.key)}
            onBlur={() => onHover?.(null)}
            aria-pressed={!off}
            title="Click to hide/show; hover to highlight"
            className={`flex items-center gap-1.5 rounded-[3px] border px-2 py-[3px] text-[11px] transition ${
              off ? "border-line text-ink-4" : focus === s.key ? "border-accent/50 bg-accent/10 text-ink" : "border-line-strong text-ink-2 hover:text-ink"
            }`}
          >
            <span
              className="inline-block h-[3px] w-3.5 rounded"
              style={{
                background: off
                  ? "#2a3646"
                  : s.dashed
                    ? `repeating-linear-gradient(90deg, ${s.color} 0 3px, transparent 3px 5px)`
                    : s.dotted
                      ? `repeating-linear-gradient(90deg, ${s.color} 0 1.5px, transparent 1.5px 4px)`
                      : s.color,
              }}
            />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
