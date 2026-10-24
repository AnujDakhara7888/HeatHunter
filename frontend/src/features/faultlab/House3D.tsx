import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Box, Eye, Fan, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { DiagnosisStatus } from "../../lib/api";
import { fmt } from "../../lib/format";
import { CEILING_M, PLAN_EXTENT, PLAN_ROOMS, PLAN_UNMODELED, PLAN_WINDOWS, type Rect } from "../../lib/geometry";
import { TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";
import { useAnyModalOpen } from "../../lib/modal";
import type { RoomReading } from "./TwinHouse";

const H = CEILING_M;
const T = 0.09; // wall thickness (m), schematic
const SILL = 0.9;
const HEAD = 2.1;
const WARM = new THREE.Color("#3b4a5c");
const COLD = new THREE.Color("#2f86ff");
const ALERT = { ambiguous: "#f2a516", confident: "#ef5350" } as const;

const toWorld = (x: number, y: number): [number, number] => [(x - PLAN_EXTENT.w / 2) / 100, (y - PLAN_EXTENT.h / 2) / 100];

/** 0 = warmest room right now, 1 = coldest. */
function coldness(temp: number | null, [lo, hi]: [number, number]): number | null {
  if (temp === null) return null;
  return hi > lo ? Math.min(1, Math.max(0, (hi - temp) / (hi - lo))) : 0.5;
}

interface WallPiece {
  pos: [number, number, number];
  size: [number, number, number];
  glass?: boolean;
}

/** Splits each room edge into solid wall, sill, head and glass pieces at documented windows. */
function wallPieces(r: Rect): WallPiece[] {
  const pieces: WallPiece[] = [];
  const horizontal = (yPlan: number, inward: number) => {
    const windows = PLAN_WINDOWS.filter((w) => Math.abs(w.y1 - yPlan) < 1 && w.x1 >= r.x - 1 && w.x2 <= r.x + r.w + 1).sort((a, b) => a.x1 - b.x1);
    let cursor = r.x;
    const z = toWorld(0, yPlan)[1] + inward;
    const solid = (a: number, b: number, y0: number, y1: number, glass = false) => {
      if (b - a < 1) return;
      const cx = toWorld((a + b) / 2, 0)[0];
      pieces.push({ pos: [cx, (y0 + y1) / 2, z], size: [(b - a) / 100, y1 - y0, glass ? T * 0.5 : T], glass });
    };
    for (const w of windows) {
      solid(cursor, w.x1, 0, H);
      solid(w.x1, w.x2, 0, SILL);
      solid(w.x1, w.x2, HEAD, H);
      solid(w.x1, w.x2, SILL, HEAD, true);
      cursor = w.x2;
    }
    solid(cursor, r.x + r.w, 0, H);
  };
  const vertical = (xPlan: number, inward: number) => {
    const x = toWorld(xPlan, 0)[0] + inward;
    const cz = toWorld(0, r.y + r.h / 2)[1];
    pieces.push({ pos: [x, H / 2, cz], size: [T, H, r.h / 100] });
  };
  horizontal(r.y, T / 2);
  horizontal(r.y + r.h, -T / 2);
  vertical(r.x, T / 2);
  vertical(r.x + r.w, -T / 2);
  return pieces;
}

function Walls({ rect, faded }: { rect: Rect; faded?: boolean }) {
  const pieces = useMemo(() => wallPieces(rect), [rect]);
  return (
    <group>
      {pieces.map((p, i) =>
        p.glass ? (
          <mesh key={i} position={p.pos}>
            <boxGeometry args={p.size} />
            <meshStandardMaterial color="#7fe3ff" transparent opacity={0.28} roughness={0.05} metalness={0.2} emissive="#22d3ee" emissiveIntensity={0.25} />
          </mesh>
        ) : (
          <mesh key={i} position={p.pos} castShadow receiveShadow>
            <boxGeometry args={p.size} />
            <meshStandardMaterial color={faded ? "#2b3542" : "#d5dde6"} roughness={0.85} transparent={faded} opacity={faded ? 0.55 : 1} />
          </mesh>
        ),
      )}
    </group>
  );
}

function Room({
  id,
  reading,
  range,
  selected,
  hovered,
  alert,
  truth,
  onSelect,
  onHover,
}: {
  id: TwinRoomId;
  reading: RoomReading | undefined;
  range: [number, number];
  selected: boolean;
  hovered: boolean;
  alert: string | null;
  truth: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
}) {
  const rect = PLAN_ROOMS[id];
  const [cx, cz] = toWorld(rect.x + rect.w / 2, rect.y + rect.h / 2);
  const w = rect.w / 100;
  const d = rect.h / 100;
  const c = coldness(reading?.temp ?? null, range);
  const color = useMemo(() => (c === null ? new THREE.Color("#2a333f") : WARM.clone().lerp(COLD, c)), [c]);
  const glow = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = alert ? 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.2)) : 0;
  });

  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={color} roughness={0.6} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh
        position={[0, H / 2 + 0.03, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
        }}
        onPointerOut={() => onHover(false)}
      >
        <boxGeometry args={[w - 2 * T, H - 0.02, d - 2 * T]} />
        <meshStandardMaterial color={color} transparent opacity={0.1 + (c ?? 0) * 0.16 + (hovered ? 0.06 : 0)} depthWrite={false} emissive={color} emissiveIntensity={0.5} />
        {(selected || hovered) && <Edges color="#22d3ee" lineWidth={selected ? 2 : 1} />}
      </mesh>
      {alert && (
        <mesh position={[0, H / 2 + 0.03, 0]}>
          <boxGeometry args={[w + 0.06, H + 0.06, d + 0.06]} />
          <meshStandardMaterial ref={glow} color={alert} emissive={alert} emissiveIntensity={1.4} transparent opacity={0.2} depthWrite={false} />
          <Edges color={alert} lineWidth={2} />
        </mesh>
      )}
      {truth && (
        <mesh position={[0, H / 2 + 0.03, 0]}>
          <boxGeometry args={[w + 0.14, H + 0.14, d + 0.14]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color="#f2a516" lineWidth={1.5} />
        </mesh>
      )}
      <Walls rect={rect} />
    </group>
  );
}

function Unmodeled() {
  return (
    <>
      {PLAN_UNMODELED.map(({ label, rect }) => {
        const [cx, cz] = toWorld(rect.x + rect.w / 2, rect.y + rect.h / 2);
        return (
          <group key={label}>
            <mesh position={[cx, 0.02, cz]} receiveShadow>
              <boxGeometry args={[rect.w / 100, 0.04, rect.h / 100]} />
              <meshStandardMaterial color="#1a222c" roughness={1} />
            </mesh>
            <Walls rect={rect} faded />
          </group>
        );
      })}
    </>
  );
}

// Labels are plain React DOM over the canvas, positioned by projecting 3D anchors
// each frame. (drei <Html> portals threw on unmount when the canvas went away.)
const LABEL_ANCHORS: Record<string, THREE.Vector3> = Object.fromEntries([
  ...TWIN_ORDER.map((id) => {
    const r = PLAN_ROOMS[id];
    const [x, z] = toWorld(r.x + r.w / 2, r.y + r.h / 2);
    return [id, new THREE.Vector3(x, H + 0.45, z)];
  }),
  (() => {
    const r = PLAN_UNMODELED.find((u) => u.label === "Bathroom")!.rect;
    const [x, z] = toWorld(r.x + r.w / 2, r.y + r.h / 2);
    return ["bathroom", new THREE.Vector3(x, 0.4, z)];
  })(),
]);

function LabelProjector({ refs }: { refs: React.RefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [key, anchor] of Object.entries(LABEL_ANCHORS)) {
      const el = refs.current?.[key];
      if (!el) continue;
      v.copy(anchor).project(camera);
      const visible = v.z < 1;
      el.style.opacity = visible ? "1" : "0";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

type View = "iso" | "top" | "front";
const VIEWS: Record<View, [number, number, number]> = {
  iso: [8.6, 9.4, 11.2],
  top: [0, 15, 0.01],
  front: [0, 4.6, 14],
};

/** Narrow viewports need the camera further back to fit the whole house. */
function viewFor(view: View, aspect: number): THREE.Vector3 {
  const f = aspect < 0.9 ? 1.75 : aspect < 1.3 ? 1.3 : 1;
  return new THREE.Vector3(...VIEWS[view]).multiplyScalar(f);
}

function CameraRig({ view, nonce, controls }: { view: View; nonce: number; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, size } = useThree();
  const target = useRef<THREE.Vector3 | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  useEffect(() => {
    target.current = viewFor(view, aspect);
  }, [view, nonce, aspect]);
  useFrame(() => {
    if (!target.current) return;
    camera.position.lerp(target.current, 0.08);
    controls.current?.target.lerp(new THREE.Vector3(0, 0.8, 0), 0.08);
    controls.current?.update();
    if (camera.position.distanceTo(target.current) < 0.02) target.current = null;
  });
  return null;
}

export default function House3D({
  readings,
  range,
  selected,
  onSelect,
  flagged,
  status,
  truthRoom,
  repairedRoom,
  fanOn,
  idle,
  simpleLabels = false,
  height = 460,
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
  idle: boolean;
  simpleLabels?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<TwinRoomId | null>(null);
  const [view, setView] = useState<View>("iso");
  const [nonce, setNonce] = useState(0);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const paused = useAnyModalOpen();
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  const alert = status === "confident" ? ALERT.confident : status === "ambiguous" ? ALERT.ambiguous : null;

  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  const go = (v: View) => {
    setView(v);
    setNonce((n) => n + 1);
  };

  return (
    <div className="relative overflow-hidden rounded-xl" style={{ height }}>
      <Canvas
        shadows={!small}
        dpr={small ? [1, 1.5] : [1, 2]}
        frameloop={paused ? "never" : "always"}
        camera={{ position: VIEWS.iso, fov: 34, near: 0.1, far: 100 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => setHover(null)}
        aria-label="Interactive 3D model of the approximate HH09 digital twin"
      >
        <color attach="background" args={["#080c11"]} />
        <fog attach="fog" args={["#080c11", 16, 30]} />
        <hemisphereLight args={["#9fc6ff", "#0a0f16", 0.55]} />
        <directionalLight
          position={[6, 11, 5]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
        />
        <directionalLight position={[-6, 5, -4]} intensity={0.35} color="#7fb4ff" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <circleGeometry args={[11, 64]} />
          <meshStandardMaterial color="#0c121a" roughness={1} />
        </mesh>
        <gridHelper args={[22, 44, "#16212d", "#111a24"]} position={[0, 0, 0]} />
        <Unmodeled />
        {TWIN_ORDER.map((id) => (
          <Room
            key={id}
            id={id}
            reading={readings[id]}
            range={range}
            selected={selected === id}
            hovered={hover === id}
            alert={flagged === id ? alert : null}
            truth={truthRoom === id}
            onSelect={() => onSelect(id)}
            onHover={(on) => setHover((h) => (on ? id : h === id ? null : h))}
          />
        ))}
        <OrbitControls
          ref={controls}
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={6}
          maxDistance={30}
          minPolarAngle={0.05}
          maxPolarAngle={1.38}
          target={[0, 0.8, 0]}
          autoRotate={idle}
          autoRotateSpeed={0.6}
        />
        <CameraRig view={view} nonce={nonce} controls={controls} />
        <LabelProjector refs={labels} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {TWIN_ORDER.map((id) => {
          const meta = TWIN_ROOMS[id];
          const reading = readings[id];
          const isAlert = flagged === id ? alert : null;
          const isSelected = selected === id;
          return (
            <div
              key={id}
              ref={(el) => {
                labels.current[id] = el;
              }}
              className="absolute left-0 top-0 transition-opacity"
              style={{ transform: "translate(-9999px, -9999px)" }}
            >
              <div
                className={`whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-center shadow-lg backdrop-blur-md ${
                  isSelected ? "border-accent/70 bg-[#0b1a22]/90" : "border-white/10 bg-[#0b1017]/80"
                }`}
              >
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-ink">
                  <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                  {meta.name}
                </div>
                <div className="num text-[15px] font-semibold leading-tight text-white">{reading?.temp != null ? `${fmt(reading.temp)}°C` : "—"}</div>
                {isAlert && (
                  <div className="mt-0.5 text-[10px] font-semibold" style={{ color: isAlert }}>
                    {simpleLabels ? "⚠ Losing heat fast" : "▲ ANOMALY"}
                  </div>
                )}
                {repairedRoom === id && <div className="mt-0.5 text-[10px] font-semibold text-ok">✓ Repaired</div>}
                {truthRoom === id && <div className="mt-0.5 text-[10px] font-semibold text-warn">★ True fault</div>}
              </div>
            </div>
          );
        })}
        <div
          ref={(el) => {
            labels.current.bathroom = el;
          }}
          className="absolute left-0 top-0"
          style={{ transform: "translate(-9999px, -9999px)" }}
        >
          <div className="whitespace-nowrap rounded-lg bg-black/50 px-2 py-0.5 text-[10px] text-ink-3">Bathroom · not modelled</div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <span className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10.5px] text-ink-3 backdrop-blur">
          Drag to rotate · scroll to zoom · click a room
        </span>
        <div className="pointer-events-auto flex gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur">
          {(
            [
              ["iso", "3D", Box],
              ["top", "Top", Eye],
              ["front", "Front", RotateCcw],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => go(v)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition ${view === v ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink"}`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>
      {fanOn && (
        <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-[#07141a]/85 px-3 py-2 text-[11.5px] text-accent backdrop-blur">
          <Fan size={14} className="animate-spin [animation-duration:1.2s]" /> Exhaust fan running (simulated)
        </div>
      )}
    </div>
  );
}
