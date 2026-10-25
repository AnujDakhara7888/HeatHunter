import type { HomePlan, PlanRoom } from "../api/types";
import { wallSegments, type WallSegment } from "../lib/plan";

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

/** Footprint grid: cells between room edges, marked where a room covers them. */
function footprint(rooms: PlanRoom[]) {
  const uniq = (vs: number[]) => [...new Set(vs.map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q);
  const xs = uniq(rooms.flatMap((r) => [r.x, r.x + r.width]));
  const zs = uniq(rooms.flatMap((r) => [r.z, r.z + r.depth]));
  const covered = zs.slice(0, -1).map((z0, j) =>
    xs.slice(0, -1).map((x0, i) => {
      const cx = (x0 + xs[i + 1]) / 2;
      const cz = (z0 + zs[j + 1]) / 2;
      return rooms.some((r) => cx > r.x && cx < r.x + r.width && cz > r.z && cz < r.z + r.depth);
    }),
  );
  return { xs, zs, covered };
}

/**
 * Roof that follows the rooms wherever they are moved: the largest fully covered
 * rectangle gets a gable, every detached rectangular block gets its own gable, and
 * whatever is left (wings, bays) gets flat roofs. Gaps between rooms stay open.
 */
export function roofLayout(plan: HomePlan): { gables: Rect[]; flats: Rect[] } {
  if (!plan.rooms.length) return { gables: [], flats: [] };
  const { xs, zs, covered } = footprint(plan.rooms);
  const nz = covered.length;
  const nx = xs.length - 1;
  const used = covered.map((row) => row.map(() => false));
  const rect = (i0: number, j0: number, i1: number, j1: number): Rect => ({ x: xs[i0], z: zs[j0], w: xs[i1 + 1] - xs[i0], d: zs[j1 + 1] - zs[j0] });
  const mark = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) used[j][i] = true;
  };

  // Main gable: the largest rectangle of covered cells.
  let best: [number, number, number, number] | null = null;
  let bestArea = 0;
  for (let j0 = 0; j0 < nz; j0++)
    for (let i0 = 0; i0 < nx; i0++) {
      let limit = nx - 1;
      for (let j1 = j0; j1 < nz && covered[j1][i0]; j1++) {
        let i1 = i0;
        while (i1 < limit && covered[j1][i1 + 1]) i1++;
        limit = i1;
        const r = rect(i0, j0, limit, j1);
        if (r.w * r.d > bestArea) ((bestArea = r.w * r.d), (best = [i0, j0, limit, j1]));
      }
    }
  const gables: Rect[] = [];
  if (best) {
    gables.push(rect(...best));
    mark(...best);
  }

  // Connected blocks of the rest: a detached rectangle gets a gable, anything else flat strips.
  const flats: Rect[] = [];
  const seen = used.map((row) => row.slice());
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (!covered[j][i] || seen[j][i]) continue;
      const cells: [number, number][] = [];
      let touchesRoof = false;
      const stack: [number, number][] = [[i, j]];
      seen[j][i] = true;
      while (stack.length) {
        const [ci, cj] = stack.pop()!;
        cells.push([ci, cj]);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz || !covered[nj][ni]) continue;
          if (used[nj][ni]) touchesRoof = true;
          if (seen[nj][ni]) continue;
          seen[nj][ni] = true;
          stack.push([ni, nj]);
        }
      }
      const i0 = Math.min(...cells.map((c) => c[0]));
      const i1 = Math.max(...cells.map((c) => c[0]));
      const j0 = Math.min(...cells.map((c) => c[1]));
      const j1 = Math.max(...cells.map((c) => c[1]));
      if (!touchesRoof && cells.length === (i1 - i0 + 1) * (j1 - j0 + 1)) {
        gables.push(rect(i0, j0, i1, j1));
        mark(i0, j0, i1, j1);
        continue;
      }
      // Flat roof: merge each row's runs, then stack identical runs vertically.
      const runs: { i0: number; i1: number; j0: number; j1: number }[] = [];
      for (let rj = j0; rj <= j1; rj++) {
        let ri = i0;
        while (ri <= i1) {
          if (!cells.some((c) => c[0] === ri && c[1] === rj)) {
            ri++;
            continue;
          }
          let re = ri;
          while (re + 1 <= i1 && cells.some((c) => c[0] === re + 1 && c[1] === rj)) re++;
          const above = runs.find((u) => u.i0 === ri && u.i1 === re && u.j1 === rj - 1);
          if (above) above.j1 = rj;
          else runs.push({ i0: ri, i1: re, j0: rj, j1: rj });
          ri = re + 1;
        }
      }
      for (const u of runs) mark(u.i0, u.j0, u.i1, u.j1);
      flats.push(...runs.map((u) => rect(u.i0, u.j0, u.i1, u.j1)));
    }
  return { gables, flats: flats.filter((p) => p.w > 0.05 && p.d > 0.05) };
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
