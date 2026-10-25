import type { HomePlan } from "../api/types";
import type { WallSegment } from "../lib/plan";

const CLEARANCE = 0.25; // metres kept between the eye and a wall

/** Room whose rectangle contains the point, if any. */
export function roomAt(plan: HomePlan, x: number, z: number): string | null {
  const r = plan.rooms.find((room) => x >= room.x && x <= room.x + room.width && z >= room.z && z <= room.z + room.depth);
  return r?.room_id ?? null;
}

/**
 * True when a step from `a` to `b` would cross a wall. Interior doorways are
 * passable; exterior doors stay shut (heating-off protocol) and windows are walls.
 */
export function blocked(plan: HomePlan, segments: WallSegment[], a: [number, number], b: [number, number]): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return false;
  const k = (len + CLEARANCE) / len;
  const end: [number, number] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  if (!roomAt(plan, b[0], b[1])) return true;
  for (const s of segments) {
    const horizontal = s.z0 === s.z1;
    const at = horizontal ? s.z0 : s.x0;
    const p0 = horizontal ? a[1] : a[0];
    const p1 = horizontal ? end[1] : end[0];
    if ((p0 - at) * (p1 - at) > 0 || p0 === p1) continue;
    const t = (at - p0) / (p1 - p0);
    const along = horizontal ? a[0] + (end[0] - a[0]) * t : a[1] + (end[1] - a[1]) * t;
    const lo = horizontal ? Math.min(s.x0, s.x1) : Math.min(s.z0, s.z1);
    const hi = horizontal ? Math.max(s.x0, s.x1) : Math.max(s.z0, s.z1);
    if (along < lo - 0.05 || along > hi + 0.05) continue;
    const offset = along - lo;
    const doorway = !s.exterior && s.openings.some((o) => o.kind === "door" && offset > o.a + 0.08 && offset < o.b - 0.08);
    if (!doorway) return true;
  }
  return false;
}
