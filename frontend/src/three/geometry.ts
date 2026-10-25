import type { HomePlan, PlanRoom } from "../api/types";
import { planBounds, wallSegments, type WallSegment } from "../lib/plan";

export const WALL_H = 2.4;
export const WALL_T = 0.14;

export type Rect = { x: number; z: number; w: number; d: number };

/** Outward unit normal of an exterior segment (pointing away from its room). */
export function outwardNormal(seg: WallSegment, plan: HomePlan): [number, number] {
  const room = plan.rooms.find((r) => r.room_id === seg.rooms[0]);
  const horizontal = seg.z0 === seg.z1;
  if (!room) return horizontal ? [0, 1] : [1, 0];
  const cx = room.x + room.width / 2;
  const cz = room.z + room.depth / 2;
  return horizontal ? [0, seg.z0 > cz ? 1 : -1] : [seg.x0 > cx ? 1 : -1, 0];
}

function coverage(rect: Rect, rooms: PlanRoom[]) {
  let area = 0;
  for (const r of rooms) {
    const w = Math.max(0, Math.min(rect.x + rect.w, r.x + r.width) - Math.max(rect.x, r.x));
    const d = Math.max(0, Math.min(rect.z + rect.d, r.z + r.depth) - Math.max(rect.z, r.z));
    area += w * d;
  }
  return area / (rect.w * rect.d);
}

/** The largest well-covered rectangle gets a gable roof; the rest gets flat roofs. */
export function roofLayout(plan: HomePlan): { main: Rect; flats: Rect[] } {
  const rooms = plan.rooms;
  const bbox = (rs: PlanRoom[]): Rect => {
    const b = planBounds({ ...plan, rooms: rs });
    return { x: b.minX, z: b.minZ, w: b.w, d: b.d };
  };
  let main = bbox(rooms);
  if (coverage(main, rooms) < 0.95) {
    let best: Rect | null = null;
    for (const skip of rooms) {
      const rect = bbox(rooms.filter((r) => r !== skip));
      if (coverage(rect, rooms) >= 0.95 && (!best || rect.w * rect.d > best.w * best.d)) best = rect;
    }
    if (best) main = best;
  }
  const flats: Rect[] = [];
  for (const r of rooms) {
    const pieces: Rect[] = [];
    const x0 = r.x;
    const x1 = r.x + r.width;
    const z0 = r.z;
    const z1 = r.z + r.depth;
    const mx1 = main.x + main.w;
    const mz1 = main.z + main.d;
    if (x1 <= main.x + 0.01 || x0 >= mx1 - 0.01 || z1 <= main.z + 0.01 || z0 >= mz1 - 0.01) {
      pieces.push({ x: x0, z: z0, w: r.width, d: r.depth });
    } else {
      if (z1 > mz1 + 0.01) pieces.push({ x: x0, z: mz1, w: r.width, d: z1 - mz1 });
      if (z0 < main.z - 0.01) pieces.push({ x: x0, z: z0, w: r.width, d: main.z - z0 });
      if (x1 > mx1 + 0.01) pieces.push({ x: mx1, z: Math.max(z0, main.z), w: x1 - mx1, d: Math.min(z1, mz1) - Math.max(z0, main.z) });
      if (x0 < main.x - 0.01) pieces.push({ x: x0, z: Math.max(z0, main.z), w: main.x - x0, d: Math.min(z1, mz1) - Math.max(z0, main.z) });
    }
    flats.push(...pieces.filter((p) => p.w > 0.05 && p.d > 0.05));
  }
  return { main, flats };
}

export type WallPiece = { cx: number; cz: number; len: number; y0: number; y1: number; rot: number; exterior: boolean };
export type GlassPiece = { cx: number; cz: number; len: number; y0: number; y1: number; rot: number };

/** Break wall segments into solid boxes (around openings) and glass panes. */
export function wallPieces(plan: HomePlan) {
  const segments = wallSegments(plan);
  const walls: WallPiece[] = [];
  const glass: GlassPiece[] = [];
  const doors: GlassPiece[] = [];
  for (const seg of segments) {
    const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
    const dx = (seg.x1 - seg.x0) / len;
    const dz = (seg.z1 - seg.z0) / len;
    const rot = -Math.atan2(dz, dx);
    const at = (t: number) => [seg.x0 + dx * t, seg.z0 + dz * t] as const;
    const add = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 0.02 || y1 - y0 < 0.02) return;
      const [cx, cz] = at((a + b) / 2);
      walls.push({ cx, cz, len: b - a + (seg.exterior ? WALL_T : 0.02), y0, y1, rot, exterior: seg.exterior });
    };
    const openings = [...seg.openings].sort((p, q) => p.a - q.a);
    let cur = 0;
    for (const o of openings) {
      add(cur, o.a, 0, WALL_H);
      const sill = o.kind === "window" ? 0.9 : 0;
      const head = o.kind === "window" ? 2.1 : 2.05;
      add(o.a, o.b, 0, sill);
      add(o.a, o.b, head, WALL_H);
      if (o.kind === "door" && seg.exterior) {
        const [cx, cz] = at((o.a + o.b) / 2);
        doors.push({ cx, cz, len: o.b - o.a, y0: 0, y1: 2.05, rot });
      }
      if (o.kind === "window") {
        const [cx, cz] = at((o.a + o.b) / 2);
        glass.push({ cx, cz, len: o.b - o.a, y0: sill, y1: head, rot });
      }
      cur = o.b;
    }
    add(cur, len, 0, WALL_H);
  }
  return { segments, walls, glass, doors };
}
