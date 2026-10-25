import type { HomeReadings, HypothesisSummary, NightInfo, RoomHistory, RoomNightSnapshot, RoomStatus } from "../api/types";
import { ms } from "./rooms";

/** What the app knew about a room right after night `n` (1-based), or null before its first scored night. */
export function snapAt(room: RoomHistory | undefined, n: number): RoomNightSnapshot | null {
  let best: RoomNightSnapshot | null = null;
  for (const s of room?.snapshots ?? []) if (s.night_number <= n) best = s;
  return best;
}

export const statusAt = (room: RoomHistory | undefined, n: number): RoomStatus => snapAt(room, n)?.status ?? "not_enough_data";

/** Status for every night 1..n (carrying the last known status over nights the room was not scored). */
export function statusStrip(room: RoomHistory | undefined, n: number): { night: number; snap: RoomNightSnapshot | null }[] {
  return Array.from({ length: n }, (_, i) => ({ night: i + 1, snap: snapAt(room, i + 1) }));
}

/**
 * BIC weights: exp(-BIC/2) normalised over the hypotheses. A standard way to turn BIC
 * differences into relative support for each explanation (not a calibrated probability).
 */
export function bicWeights(fits: HypothesisSummary[]): Record<string, number> {
  if (!fits.length) return {};
  const min = Math.min(...fits.map((f) => f.bic));
  const raw = fits.map((f) => [f.fault_type, Math.exp(-(f.bic - min) / 2)] as const);
  const total = raw.reduce((a, [, w]) => a + w, 0);
  return Object.fromEntries(raw.map(([k, w]) => [k, w / total]));
}

const FLAGGED: RoomStatus[] = ["issue", "issue_cause_unclear", "still_an_issue"];

export type Milestones = {
  firstSign: RoomNightSnapshot | null;
  flagged: RoomNightSnapshot | null;
  named: RoomNightSnapshot | null;
  fixAt: RoomNightSnapshot | null;
  resolved: RoomNightSnapshot | null;
  stillBad: RoomNightSnapshot | null;
};

/** The moments in a room's story up to night `n`. */
export function milestones(room: RoomHistory | undefined, n: number): Milestones {
  const shots = (room?.snapshots ?? []).filter((s) => s.night_number <= n);
  const before = shots.filter((s) => !s.after_fix);
  const after = shots.filter((s) => s.after_fix);
  return {
    firstSign: before.find((s) => s.candidate) ?? null,
    flagged: before.find((s) => FLAGGED.includes(s.status)) ?? null,
    named: before.find((s) => s.named_cause != null) ?? null,
    fixAt: after[0] ?? null,
    resolved: after.find((s) => s.status === "resolved") ?? null,
    stillBad: after.find((s) => s.status === "still_an_issue") ?? null,
  };
}

export type NightDrop = { night: number; info: NightInfo; drop: number | null };

/** How far a room's measured temperature fell over each heating-off night. */
export function nightGaps(readings: HomeReadings, roomId: string, upTo: number): NightDrop[] {
  const r = readings.rooms[roomId];
  return readings.nights.slice(0, upTo).map((info, i) => {
    const a = ms(info.start);
    const b = ms(info.end);
    const vals = r ? r.measured.timestamps.map((t, k) => [ms(t), r.measured.values[k]] as const).filter(([t, v]) => t >= a && t <= b && v != null) : [];
    return { night: i + 1, info, drop: vals.length > 1 ? (vals[0][1] as number) - (vals[vals.length - 1][1] as number) : null };
  });
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
