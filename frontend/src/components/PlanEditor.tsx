import { DoorOpen, MousePointer2, Plus, RectangleHorizontal, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { HomePlan, PlanRoom } from "../api/types";
import { planBounds, slug, wallSegments } from "../lib/plan";
import { roomColor } from "../lib/rooms";

type Tool = "select" | "window" | "door";
type Drag = { id: string; mode: "move" | "resize"; sx: number; sz: number; room: PlanRoom } | null;

const SNAP = 0.05;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

type Props = {
  plan: HomePlan;
  onChange: (plan: HomePlan) => void;
  background?: { url: string; widthM: number; opacity: number } | null;
};

/** Minimal floor-plan editor: rectangles in metres, walls and openings derived like the 3D model. */
export function PlanEditor({ plan, onChange, background }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const b = planBounds(plan);
  const pad = 1.2;
  const view = { x: Math.min(0, b.minX) - pad, z: Math.min(0, b.minZ) - pad, w: Math.max(b.maxX, 8) - Math.min(0, b.minX) + pad * 2, d: Math.max(b.maxZ, 6) - Math.min(0, b.minZ) + pad * 2 };
  const segments = useMemo(() => wallSegments(plan), [plan]);

  const toPlan = (e: React.PointerEvent): [number, number] => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const edgeSnap = (v: number, axis: "x" | "z", skip: string) => {
    for (const r of plan.rooms) {
      if (r.room_id === skip) continue;
      for (const e of axis === "x" ? [r.x, r.x + r.width] : [r.z, r.z + r.depth]) if (Math.abs(e - v) < 0.18) return e;
    }
    return snap(v);
  };

  const update = (id: string, patch: Partial<PlanRoom>) =>
    onChange({ ...plan, rooms: plan.rooms.map((r) => (r.room_id === id ? { ...r, ...patch } : r)) });

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, z] = toPlan(e);
    const dx = x - drag.sx;
    const dz = z - drag.sz;
    if (drag.mode === "move") {
      const nx = edgeSnap(drag.room.x + dx, "x", drag.id);
      const nz = edgeSnap(drag.room.z + dz, "z", drag.id);
      update(drag.id, { x: nx, z: nz });
    } else {
      const right = edgeSnap(drag.room.x + drag.room.width + dx, "x", drag.id);
      const bottom = edgeSnap(drag.room.z + drag.room.depth + dz, "z", drag.id);
      update(drag.id, { width: Math.max(0.6, right - drag.room.x), depth: Math.max(0.6, bottom - drag.room.z) });
    }
  };

  const addOpening = (e: React.PointerEvent) => {
    const [x, z] = toPlan(e);
    let best: { d: number; seg: (typeof segments)[number] } | null = null;
    for (const seg of segments) {
      const horizontal = seg.z0 === seg.z1;
      const inside = horizontal ? x > seg.x0 && x < seg.x1 : z > seg.z0 && z < seg.z1;
      if (!inside) continue;
      const d = horizontal ? Math.abs(z - seg.z0) : Math.abs(x - seg.x0);
      if (d < 0.35 && (!best || d < best.d)) best = { d, seg };
    }
    if (!best) return;
    const half = tool === "window" ? 0.6 : 0.45;
    const s = best.seg;
    const opening =
      s.z0 === s.z1
        ? { kind: tool as "window" | "door", x0: snap(Math.max(s.x0, x - half)), z0: s.z0, x1: snap(Math.min(s.x1, x + half)), z1: s.z0 }
        : { kind: tool as "window" | "door", x0: s.x0, z0: snap(Math.max(s.z0, z - half)), x1: s.x0, z1: snap(Math.min(s.z1, z + half)) };
    onChange({ ...plan, openings: [...(plan.openings ?? []), opening] });
  };

  const addRoom = () => {
    const taken = new Set(plan.rooms.map((r) => r.room_id));
    const id = slug(`room ${plan.rooms.length + 1}`, taken);
    const room: PlanRoom = { room_id: id, name: `Room ${plan.rooms.length + 1}`, x: snap(b.maxX), z: snap(b.minZ), width: 3, depth: 3, has_sensor: true, exposed_floor: true, exposed_roof: true };
    onChange({ ...plan, rooms: [...plan.rooms, room] });
    setSelected(id);
  };

  const sel = plan.rooms.find((r) => r.room_id === selected);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          ["select", <MousePointer2 key="s" size={14} />, "Move / resize"],
          ["window", <RectangleHorizontal key="w" size={14} />, "Add window"],
          ["door", <DoorOpen key="d" size={14} />, "Add door"],
        ] as const).map(([t, icon, label]) => (
          <button key={t} onClick={() => setTool(t)} className={`btn !px-3 !py-1.5 !text-[12px] ${tool === t ? "btn-primary" : "btn-ghost"}`}>
            {icon} {label}
          </button>
        ))}
        <button onClick={addRoom} className="btn btn-ghost !px-3 !py-1.5 !text-[12px]">
          <Plus size={14} /> Room
        </button>
      </div>
      <div className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-[#0a0d13]">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.z} ${view.w} ${view.d}`}
          className="h-full w-full touch-none select-none"
          onPointerMove={onMove}
          onPointerUp={() => setDrag(null)}
          onPointerLeave={() => setDrag(null)}
          onPointerDown={(e) => {
            if (tool !== "select") addOpening(e);
            else if (e.target === svg.current) setSelected(null);
          }}
        >
          <defs>
            <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#ffffff10" strokeWidth="0.02" />
            </pattern>
          </defs>
          <rect x={view.x} y={view.z} width={view.w} height={view.d} fill="url(#grid)" pointerEvents="none" />
          {background && (
            <image href={background.url} x={0} y={0} width={background.widthM} opacity={background.opacity} preserveAspectRatio="xMinYMin meet" pointerEvents="none" />
          )}
          {plan.rooms.map((r) => (
            <g key={r.room_id}>
              <rect
                x={r.x}
                y={r.z}
                width={r.width}
                height={r.depth}
                fill={roomColor(r.room_id, plan.rooms.map((x) => x.room_id))}
                fillOpacity={selected === r.room_id ? 0.32 : 0.16}
                stroke={selected === r.room_id ? "#fff" : "#ffffff55"}
                strokeWidth={0.04}
                className={tool === "select" ? "cursor-move" : "cursor-crosshair"}
                onPointerDown={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture(e.pointerId);
                  const [sx, sz] = toPlan(e);
                  setSelected(r.room_id);
                  setDrag({ id: r.room_id, mode: "move", sx, sz, room: r });
                }}
              />
              <text x={r.x + r.width / 2} y={r.z + r.depth / 2} textAnchor="middle" fontSize={0.32} fill="#f2f3f5" pointerEvents="none">
                {r.name}
              </text>
              <text x={r.x + r.width / 2} y={r.z + r.depth / 2 + 0.38} textAnchor="middle" fontSize={0.22} fill="#9aa1b2" pointerEvents="none">
                {r.width.toFixed(2)} × {r.depth.toFixed(2)} m{r.has_sensor === false ? " · no sensor" : ""}
              </text>
              {tool === "select" && selected === r.room_id && (
                <rect
                  x={r.x + r.width - 0.16}
                  y={r.z + r.depth - 0.16}
                  width={0.32}
                  height={0.32}
                  rx={0.06}
                  fill="#fff"
                  className="cursor-nwse-resize"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture(e.pointerId);
                    const [sx, sz] = toPlan(e);
                    setDrag({ id: r.room_id, mode: "resize", sx, sz, room: r });
                  }}
                />
              )}
            </g>
          ))}
          {segments.map((s, i) => (
            <line key={i} x1={s.x0} y1={s.z0} x2={s.x1} y2={s.z1} stroke={s.exterior ? "#f2f3f5" : "#ffffff66"} strokeWidth={s.exterior ? 0.12 : 0.06} strokeLinecap="square" pointerEvents="none" />
          ))}
          {(plan.openings ?? []).map((o, i) => (
            <line
              key={i}
              x1={o.x0}
              y1={o.z0}
              x2={o.x1}
              y2={o.z1}
              stroke={o.kind === "window" ? "#7fd4ff" : "#ffb020"}
              strokeWidth={0.16}
              className="cursor-pointer"
              onPointerDown={(e) => {
                if (tool !== "select") return;
                e.stopPropagation();
                onChange({ ...plan, openings: (plan.openings ?? []).filter((_, j) => j !== i) });
              }}
            >
              <title>click to remove</title>
            </line>
          ))}
        </svg>
        <div className="pointer-events-none absolute bottom-2 left-3 flex gap-3 text-[10.5px] text-dim">
          <span><i className="mr-1 inline-block h-0.5 w-3 bg-[#7fd4ff]" />window</span>
          <span><i className="mr-1 inline-block h-0.5 w-3 bg-[#ffb020]" />door</span>
          <span>grid = 1 m · click an opening to remove</span>
        </div>
      </div>
      {sel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <input value={sel.name} onChange={(e) => update(sel.room_id, { name: e.target.value || "Room" })} className="w-36 rounded-lg border border-line bg-transparent px-2 py-1.5 outline-none focus:border-white/40" />
          {(["width", "depth"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-mute">
              {k === "width" ? "W" : "D"}
              <input type="number" step={0.05} min={0.6} value={sel[k]} onChange={(e) => update(sel.room_id, { [k]: Math.max(0.6, Number(e.target.value)) })} className="w-16 rounded-lg border border-line bg-transparent px-2 py-1.5 text-ink outline-none" />
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-mute">
            <input type="checkbox" checked={sel.has_sensor !== false} onChange={(e) => update(sel.room_id, { has_sensor: e.target.checked })} /> sensor
          </label>
          <label className="flex items-center gap-1.5 text-mute" title="Untick for rooms with another room above">
            <input type="checkbox" checked={sel.exposed_roof !== false} onChange={(e) => update(sel.room_id, { exposed_roof: e.target.checked })} /> roof above
          </label>
          <button onClick={() => (onChange({ ...plan, rooms: plan.rooms.filter((r) => r.room_id !== sel.room_id) }), setSelected(null))} className="ml-auto text-hot/80 hover:text-hot" aria-label="Delete room">
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
