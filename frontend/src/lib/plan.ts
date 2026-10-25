import type { HomePlan, PlanRoom } from "../api/types";
import hh09 from "../../../shared/homes/hh09_plan.json";

export const HH09_PLAN = hh09 as HomePlan;
/**
 * The HH09 front door (on the plan's +z wall, into the hall) faces 240° from north:
 * SMETER_P2_WindowArea_Orientation.csv, via data/processed/hh09_twin_inputs.json.
 */
export const HH09_Z_BEARING = 240;

export type WallOpening = { a: number; b: number; kind: "window" | "door" };
export type WallSegment = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  exterior: boolean;
  rooms: string[];
  openings: WallOpening[];
};

const EPS = 0.02;
const key = (v: number) => Math.round(v * 100) / 100;

type Edge = { horizontal: boolean; at: number; from: number; to: number; room: string };

function roomEdges(r: PlanRoom): Edge[] {
  return [
    { horizontal: true, at: r.z, from: r.x, to: r.x + r.width, room: r.room_id },
    { horizontal: true, at: r.z + r.depth, from: r.x, to: r.x + r.width, room: r.room_id },
    { horizontal: false, at: r.x, from: r.z, to: r.z + r.depth, room: r.room_id },
    { horizontal: false, at: r.x + r.width, from: r.z, to: r.z + r.depth, room: r.room_id },
  ];
}

/** Split every room edge into exterior / shared wall segments and attach openings. */
export function wallSegments(plan: HomePlan): WallSegment[] {
  const groups = new Map<string, Edge[]>();
  for (const room of plan.rooms) {
    for (const edge of roomEdges(room)) {
      const k = `${edge.horizontal ? "h" : "v"}:${key(edge.at)}`;
      groups.set(k, [...(groups.get(k) ?? []), edge]);
    }
  }
  const segments: WallSegment[] = [];
  for (const edges of groups.values()) {
    const { horizontal, at } = edges[0];
    const cuts = [...new Set(edges.flatMap((e) => [key(e.from), key(e.to)]))].sort((a, b) => a - b);
    let current: { from: number; to: number; exterior: boolean; rooms: string[] } | null = null;
    const flush = () => {
      if (!current) return;
      const seg: WallSegment = horizontal
        ? { x0: current.from, z0: at, x1: current.to, z1: at, exterior: current.exterior, rooms: current.rooms, openings: [] }
        : { x0: at, z0: current.from, x1: at, z1: current.to, exterior: current.exterior, rooms: current.rooms, openings: [] };
      segments.push(seg);
      current = null;
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      const covering = edges.filter((e) => e.from <= a + EPS && e.to >= b - EPS);
      if (!covering.length) {
        flush();
        continue;
      }
      const exterior = covering.length === 1;
      const rooms = [...new Set(covering.map((e) => e.room))].sort();
      if (current && current.exterior === exterior && current.rooms.join() === rooms.join()) {
        current.to = b;
      } else {
        flush();
        current = { from: a, to: b, exterior, rooms };
      }
    }
    flush();
  }
  for (const opening of plan.openings ?? []) {
    const horizontal = Math.abs(opening.z1 - opening.z0) < Math.abs(opening.x1 - opening.x0);
    const at = horizontal ? (opening.z0 + opening.z1) / 2 : (opening.x0 + opening.x1) / 2;
    const lo = horizontal ? Math.min(opening.x0, opening.x1) : Math.min(opening.z0, opening.z1);
    const hi = horizontal ? Math.max(opening.x0, opening.x1) : Math.max(opening.z0, opening.z1);
    for (const seg of segments) {
      const segHorizontal = seg.z0 === seg.z1;
      if (segHorizontal !== horizontal) continue;
      const segAt = horizontal ? seg.z0 : seg.x0;
      if (Math.abs(segAt - at) > 0.12) continue;
      const s0 = horizontal ? seg.x0 : seg.z0;
      const s1 = horizontal ? seg.x1 : seg.z1;
      const a = Math.max(lo, s0) - s0;
      const b = Math.min(hi, s1) - s0;
      if (b - a > 0.2) seg.openings.push({ a, b, kind: opening.kind });
    }
  }
  return segments;
}

export function planBounds(plan: HomePlan) {
  const xs = plan.rooms.flatMap((r) => [r.x, r.x + r.width]);
  const zs = plan.rooms.flatMap((r) => [r.z, r.z + r.depth]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

export function roomCenter(room: PlanRoom): [number, number] {
  return [room.x + room.width / 2, room.z + room.depth / 2];
}

export function slug(name: string, taken: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36) || "room";
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}
