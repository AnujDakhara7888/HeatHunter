import type { Series } from "../api/types";

/** Fault Lab simulator slots → rooms of the documented HH09 plan (bedroom_2 is the Hall). */
export const SIM_TO_PLAN: Record<string, string> = {
  living_room: "living_room",
  kitchen: "kitchen",
  bedroom_1: "bedroom",
  bedroom_2: "hall",
};
export const PLAN_TO_SIM = Object.fromEntries(Object.entries(SIM_TO_PLAN).map(([a, b]) => [b, a]));

export const ROOM_NAMES: Record<string, string> = {
  living_room: "Living room",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  bedroom_1: "Bedroom",
  bedroom_2: "Hall",
  hall: "Hall",
  bathroom: "Bathroom",
  closet: "Closets",
};

/** Categorical room identity, validated (dark surface, adjacent pairs) with the dataviz checker. */
const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#008300"];
const FIXED: Record<string, number> = { bedroom: 0, living_room: 1, bathroom: 2, kitchen: 3, hall: 4 };

export function roomColor(planRoomId: string, order: string[] = []): string {
  const id = SIM_TO_PLAN[planRoomId] ?? planRoomId;
  if (id in FIXED) return PALETTE[FIXED[id]];
  const i = order.indexOf(id);
  return PALETTE[(i < 0 ? 5 : 5 + i) % PALETTE.length];
}

export const CAUSE = {
  normal: { label: "Normal", short: "Normal", color: "#8a90a2", icon: "✓" },
  draft: { label: "Air leak", short: "Leak", color: "#3987e5", icon: "≋" },
  envelope_conduction: { label: "Weak insulation", short: "Insulation", color: "#d95926", icon: "▦" },
} as const;
export type CauseKey = keyof typeof CAUSE;

export function displayName(id: string, names?: Record<string, string>) {
  return names?.[id] ?? ROOM_NAMES[id] ?? id.replace(/_/g, " ");
}

/** Thermal ramp: cold blue → warm orange (temperature, a physical convention). */
const STOPS: [number, [number, number, number]][] = [
  [0, [38, 52, 190]],
  [0.28, [46, 128, 230]],
  [0.5, [92, 200, 210]],
  [0.68, [238, 196, 92]],
  [0.85, [240, 128, 52]],
  [1, [222, 64, 44]],
];
export function tempRGB(t: number, lo = 12, hi = 21): [number, number, number] {
  const k = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
  for (let i = 1; i < STOPS.length; i++) {
    if (k <= STOPS[i][0]) {
      const [k0, c0] = STOPS[i - 1];
      const [k1, c1] = STOPS[i];
      const f = (k - k0) / (k1 - k0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
export const tempCSS = (t: number, lo?: number, hi?: number) => `rgb(${tempRGB(t, lo, hi).join(",")})`;

// ---------- series helpers ----------
export const ms = (iso: string) => new Date(iso).getTime();

export function valueAt(series: Series | undefined, t: number): number | null {
  if (!series) return null;
  const ts = series.timestamps;
  let lo = 0;
  let hi = ts.length - 1;
  if (t <= ms(ts[0])) return series.values[0] ?? null;
  if (t >= ms(ts[hi])) return series.values[hi] ?? null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ms(ts[mid]) <= t) lo = mid;
    else hi = mid;
  }
  const a = series.values[lo];
  const b = series.values[hi];
  if (a == null || b == null) return a ?? b ?? null;
  const f = (t - ms(ts[lo])) / (ms(ts[hi]) - ms(ts[lo]));
  return a + (b - a) * f;
}

export function seriesRange(series: Series[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) for (const v of s.values) if (v != null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  return [lo, hi];
}

export function timeRange(series: Series): [number, number] {
  return [ms(series.timestamps[0]), ms(series.timestamps[series.timestamps.length - 1])];
}

export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Cooling rate (°C per hour) over the whole series, from first and last valid readings. */
export function coolingRate(series: Series | undefined): number | null {
  if (!series) return null;
  const pts = series.timestamps.map((t, i) => [ms(t), series.values[i]] as const).filter(([, v]) => v != null);
  if (pts.length < 2) return null;
  const [t0, v0] = pts[0];
  const [t1, v1] = pts[pts.length - 1];
  return ((v1 as number) - (v0 as number)) / ((t1 - t0) / 3.6e6);
}
