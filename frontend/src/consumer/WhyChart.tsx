import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NightObservations } from "../lib/api";
import { fmt, utcTime } from "../lib/format";
import { roomName } from "../lib/rooms";

type Row = { t: number; room: number | null; others: number | null };

function firstLast(values: (number | null)[], from = 0, to = values.length - 1): [number | null, number | null] {
  let a: number | null = null;
  let b: number | null = null;
  for (let i = from; i <= to; i++) if (values[i] != null) (a ??= values[i]), (b = values[i]);
  return [a, b];
}

/** The flagged room against the average of the other rooms, from the night's own readings. */
export function compareRoom(night: NightObservations, roomId: string) {
  const ids = Object.keys(night.room_temperature_series);
  const others = ids.filter((id) => id !== roomId);
  const ts = night.weather.outdoor_temperature.timestamps;
  const roomValues = night.room_temperature_series[roomId]?.values ?? [];
  const otherValues = ts.map((_, i) => {
    const v = others.map((id) => night.room_temperature_series[id].values[i]).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  });
  const rows: Row[] = ts.map((t, i) => ({ t: Date.parse(t), room: roomValues[i] ?? null, others: otherValues[i] }));

  const drop = (values: (number | null)[], from?: number, to?: number) => {
    const [a, b] = firstLast(values, from, to);
    return a != null && b != null ? a - b : null;
  };
  const p = night.protocol;
  let fan: { start: number; end: number; label: string; roomDrop: number | null; othersDrop: number | null } | null = null;
  if (p.fan_on && p.fan_start && p.fan_end) {
    const s = Date.parse(p.fan_start);
    const e = Date.parse(p.fan_end);
    const i0 = rows.findIndex((r) => r.t >= s);
    let i1 = rows.findIndex((r) => r.t >= e);
    if (i1 < 0) i1 = rows.length - 1;
    fan = { start: s, end: e, label: `${utcTime(p.fan_start)}–${utcTime(p.fan_end)}`, roomDrop: drop(roomValues, i0, i1), othersDrop: drop(otherValues, i0, i1) };
  }
  return { rows, roomDrop: drop(roomValues), othersDrop: drop(otherValues), fan };
}

export function whySentence(night: NightObservations, roomId: string): string {
  const c = compareRoom(night, roomId);
  const room = roomName(roomId);
  if (c.fan && c.fan.roomDrop != null && c.fan.othersDrop != null) {
    return `While the fan ran (${c.fan.label}), the ${room} cooled ${fmt(c.fan.roomDrop, 1)}°C, compared with ${fmt(c.fan.othersDrop, 1)}°C for the other rooms on average.`;
  }
  if (c.roomDrop == null || c.othersDrop == null) return `The ${room}'s readings were incomplete.`;
  const diff = c.roomDrop - c.othersDrop;
  return `Overnight, the ${room} cooled ${fmt(c.roomDrop, 1)}°C — ${fmt(Math.abs(diff), 1)}°C ${diff >= 0 ? "more" : "less"} than the other rooms on average (${fmt(c.othersDrop, 1)}°C).`;
}

export function WhyChart({ night, roomId, light = false, height = 190 }: { night: NightObservations; roomId: string; light?: boolean; height?: number }) {
  const c = useMemo(() => compareRoom(night, roomId), [night, roomId]);
  const ink = light ? "#475569" : "rgba(255,255,255,0.55)";
  const grid = light ? "#e2e8f0" : "rgba(255,255,255,0.07)";
  const room = roomName(roomId);
  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={c.rows} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke={grid} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => utcTime(new Date(t).toISOString())}
              tick={{ fill: ink, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: grid }}
              minTickGap={40}
            />
            <YAxis tick={{ fill: ink, fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `${fmt(v, 0)}°`} />
            {c.fan && <ReferenceArea x1={c.fan.start} x2={c.fan.end} fill="#38bdf8" fillOpacity={light ? 0.12 : 0.1} label={{ value: "fan on", position: "insideTop", fill: light ? "#0369a1" : "#7dd3fc", fontSize: 11 }} />}
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload, label }) =>
                active && payload?.length && label !== undefined ? (
                  <div className="rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-[12px] text-white">
                    <div className="mb-1 text-white/60">{utcTime(new Date(label as number).toISOString())}</div>
                    <div>
                      {room}: <b>{fmt(payload.find((p) => p.dataKey === "room")?.value as number, 1)}°C</b>
                    </div>
                    <div>
                      Other rooms: <b>{fmt(payload.find((p) => p.dataKey === "others")?.value as number, 1)}°C</b>
                    </div>
                  </div>
                ) : null
              }
            />
            <Line type="monotone" dataKey="others" stroke={light ? "#94a3b8" : "rgba(255,255,255,0.45)"} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="room" stroke="#f97316" strokeWidth={2.6} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${light ? "text-slate-600" : "text-white/55"}`}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-4 rounded bg-orange-500" /> {room}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4" style={{ background: `repeating-linear-gradient(90deg, ${light ? "#94a3b8" : "rgba(255,255,255,0.45)"} 0 4px, transparent 4px 7px)` }} /> Other rooms (average)
        </span>
      </div>
    </div>
  );
}
