import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { fmt } from "../lib/format";
import { PLAN_EXTENT, PLAN_ROOMS, PLAN_UNMODELED, PLAN_WINDOWS, type Rect } from "../lib/geometry";
import { useAnyModalOpen } from "../lib/modal";
import { TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../lib/rooms";
import { THERMAL_STOPS, type CameraView, type Phase, type Problem } from "./houseTypes";
import { brickTexture, grassTexture, pavingTexture, roofTexture, woodTexture } from "./textures";

// Illustrative house built on the published HH09 plan dimensions. Brick, roof
// tiles, garden and furniture are decorative; temperatures come from the API.

export interface Reading {
  temp: number | null;
}

const CEIL = 2.4;
const EAVE = 2.6;
const EXT = 0.22; // exterior wall thickness (illustrative)
const INT = 0.07; // partition thickness
const SILL = 0.9;
const HEAD = 2.1;

const w = (x: number, y: number): [number, number] => [(x - PLAN_EXTENT.w / 2) / 100, (y - PLAN_EXTENT.h / 2) / 100];

/* ---------------------------------------------------------- openings */

type Opening = { axis: "h" | "v"; at: number; from: number; to: number; bottom: number; top: number; kind: "window" | "door" };
const OPENINGS: Opening[] = [
  ...PLAN_WINDOWS.map((p) => ({ axis: "h" as const, at: p.y1, from: p.x1, to: p.x2, bottom: SILL, top: HEAD, kind: "window" as const })),
  // Entrance into the hall (opening visible on the published plan) and the small bathroom window.
  { axis: "h", at: 631, from: 215, to: 300, bottom: 0, top: 2.05, kind: "door" },
  { axis: "v", at: 192, from: 675, to: 745, bottom: 1.2, top: 1.9, kind: "window" },
];

interface Piece {
  pos: [number, number, number];
  size: [number, number, number];
}

/** Wall from a→b (plan cm) at a fixed coordinate, split around openings. */
function wallRun(axis: "h" | "v", at: number, a: number, b: number, offset: number, thick: number, height: number, extend = 0): Piece[] {
  const lo = Math.min(a, b) - extend * 100;
  const hi = Math.max(a, b) + extend * 100;
  const holes = OPENINGS.filter((o) => o.axis === axis && Math.abs(o.at - at) < 15 && o.from >= lo - 1 && o.to <= hi + 1).sort((x, y) => x.from - y.from);
  const out: Piece[] = [];
  const push = (s: number, e: number, y0: number, y1: number) => {
    if (e - s < 1 || y1 - y0 < 0.01) return;
    const mid = (s + e) / 2;
    if (axis === "h") {
      const [x, z] = w(mid, at);
      out.push({ pos: [x, (y0 + y1) / 2, z + offset], size: [(e - s) / 100, y1 - y0, thick] });
    } else {
      const [x, z] = w(at, mid);
      out.push({ pos: [x + offset, (y0 + y1) / 2, z], size: [thick, y1 - y0, (e - s) / 100] });
    }
  };
  let cursor = lo;
  for (const h of holes) {
    push(cursor, h.from, 0, height);
    push(h.from, h.to, 0, h.bottom);
    push(h.from, h.to, h.top, height);
    cursor = h.to;
  }
  push(cursor, hi, 0, height);
  return out;
}

// Outer outline of the house (plan cm), walls placed outside it.
const OUTLINE: { axis: "h" | "v"; at: number; a: number; b: number; out: number }[] = [
  { axis: "h", at: 0, a: 0, b: 638, out: -1 },
  { axis: "v", at: 638, a: 0, b: 631, out: 1 },
  { axis: "h", at: 631, a: 192, b: 638, out: 1 },
  { axis: "v", at: 192, a: 631, b: 764, out: 1 },
  { axis: "h", at: 764, a: 0, b: 192, out: 1 },
  { axis: "v", at: 0, a: 0, b: 764, out: -1 },
];

function ExteriorWalls({ brick }: { brick: THREE.Texture }) {
  const pieces = useMemo(
    () => OUTLINE.flatMap((s) => wallRun(s.axis, s.at, s.a, s.b, (s.out * EXT) / 2, EXT, EAVE, s.axis === "h" ? EXT : 0)),
    [],
  );
  return (
    <group>
      {pieces.map((p, i) => {
        const tex = brick.clone();
        tex.needsUpdate = true;
        tex.repeat.set(Math.max(p.size[0], p.size[2]) / 1.1, p.size[1] / 1.1);
        return (
          <mesh key={i} position={p.pos} castShadow receiveShadow>
            <boxGeometry args={p.size} />
            <meshStandardMaterial map={tex} roughness={0.92} />
          </mesh>
        );
      })}
    </group>
  );
}

function Openings({ phase }: { phase: Phase }) {
  const warm = phase === "heating";
  return (
    <group>
      {OPENINGS.map((o, i) => {
        const len = (o.to - o.from) / 100;
        const mid = (o.from + o.to) / 2;
        const [x, z] = o.axis === "h" ? w(mid, o.at) : w(o.at, mid);
        const h = o.top - o.bottom;
        const rot = o.axis === "v" ? Math.PI / 2 : 0;
        if (o.kind === "door") {
          return (
            <group key={i} position={[x, o.bottom + h / 2, z]} rotation={[0, rot, 0]}>
              <mesh castShadow>
                <boxGeometry args={[len, h, 0.06]} />
                <meshStandardMaterial color="#5a3a24" roughness={0.6} />
              </mesh>
              <mesh position={[len * 0.3, 0, 0.04]}>
                <sphereGeometry args={[0.035, 12, 12]} />
                <meshStandardMaterial color="#d4b15a" metalness={0.8} roughness={0.3} />
              </mesh>
            </group>
          );
        }
        return (
          <group key={i} position={[x, o.bottom + h / 2, z]} rotation={[0, rot, 0]}>
            <mesh>
              <boxGeometry args={[len, h, 0.03]} />
              <meshStandardMaterial
                color={warm ? "#ffd59a" : "#9fd3ff"}
                emissive={warm ? "#ffb35c" : "#0a1a2a"}
                emissiveIntensity={warm ? 0.9 : 0.2}
                transparent
                opacity={0.45}
                roughness={0.05}
                metalness={0.3}
              />
            </mesh>
            {/* white frame */}
            {[
              [0, h / 2, len, 0.06],
              [0, -h / 2, len, 0.06],
              [-len / 2, 0, 0.06, h],
              [len / 2, 0, 0.06, h],
              [0, 0, 0.04, h],
            ].map(([fx, fy, fw, fh], k) => (
              <mesh key={k} position={[fx, fy, 0]}>
                <boxGeometry args={[fw, fh, EXT + 0.02]} />
                <meshStandardMaterial color="#f2f2ee" roughness={0.5} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/* --------------------------------------------------------------- roof */

function hipRoofGeometry(x0: number, x1: number, z0: number, z1: number, base: number, rise: number): THREE.BufferGeometry {
  const ridgeHalf = Math.max(0.2, Math.abs(x1 - x0 - (z1 - z0)) / 2 + 0.3);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const A = [x0, base, z0];
  const B = [x1, base, z0];
  const C = [x1, base, z1];
  const D = [x0, base, z1];
  const R1 = [cx - ridgeHalf, base + rise, cz];
  const R2 = [cx + ridgeHalf, base + rise, cz];
  const tris = [A, R1, R2, A, R2, B, B, R2, C, C, R2, R1, C, R1, D, D, R1, A];
  const pos = new Float32Array(tris.flat());
  const uv = new Float32Array(tris.flatMap((p) => [p[0] / 2.2, (p[2] + p[1]) / 2.2]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function Roof({ open, roofTex, brick }: { open: boolean; roofTex: THREE.Texture; brick: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  const [x0, z0] = w(-EXT * 100 - 30, -EXT * 100 - 30);
  const [x1, z1] = w(638 + EXT * 100 + 30, 631 + EXT * 100 + 30);
  const main = useMemo(() => hipRoofGeometry(x0, x1, z0, z1, EAVE, 1.75), [x0, x1, z0, z1]);
  const [bx0, bz0] = w(-EXT * 100 - 25, 631);
  const [bx1, bz1] = w(192 + EXT * 100 + 25, 764 + EXT * 100 + 25);
  const [cx, cz] = w(317, 415);
  const chimneyTex = useMemo(() => {
    const t = brick.clone();
    t.needsUpdate = true;
    t.repeat.set(0.6, 1.8);
    return t;
  }, [brick]);
  useFrame(() => {
    if (!group.current) return;
    const target = open ? 3.6 : 0;
    group.current.position.y += (target - group.current.position.y) * 0.08;
    const opacity = Math.max(0, 1 - group.current.position.y / 2.2);
    mats.current.forEach((m) => {
      m.opacity = opacity;
      m.transparent = opacity < 0.999;
      m.depthWrite = opacity > 0.6;
    });
    group.current.visible = opacity > 0.02;
  });
  const reg = (m: THREE.MeshStandardMaterial | null) => {
    if (m && !mats.current.includes(m)) mats.current.push(m);
  };
  return (
    <group ref={group}>
      <mesh geometry={main} castShadow receiveShadow>
        <meshStandardMaterial ref={reg} map={roofTex} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <mesh position={[(bx0 + bx1) / 2, EAVE + 0.12, (bz0 + bz1) / 2]} rotation={[0.12, 0, 0]} castShadow>
        <boxGeometry args={[bx1 - bx0, 0.12, bz1 - bz0]} />
        <meshStandardMaterial ref={reg} map={roofTex} roughness={0.85} />
      </mesh>
      <mesh position={[cx, EAVE + 1.25, cz]} castShadow>
        <boxGeometry args={[0.55, 2.5, 0.75]} />
        <meshStandardMaterial ref={reg} map={chimneyTex} roughness={0.9} />
      </mesh>
      <mesh position={[cx, EAVE + 2.55, cz]}>
        <boxGeometry args={[0.65, 0.12, 0.85]} />
        <meshStandardMaterial ref={reg} color="#5b4a40" />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------- environment */

const SKY: Record<Phase, { top: string; bottom: string; sun: number; hemi: number; fog: string }> = {
  day: { top: "#3d7fd1", bottom: "#cfe6f7", sun: 2.4, hemi: 0.9, fog: "#cfe6f7" },
  heating: { top: "#1f2a5a", bottom: "#e79b6a", sun: 0.9, hemi: 0.45, fog: "#6a5a6a" },
  night: { top: "#050914", bottom: "#17223b", sun: 0.35, hemi: 0.32, fog: "#0d1526" },
};

function Sky({ phase }: { phase: Phase }) {
  const { scene } = useThree();
  const uniforms = useMemo(() => ({ top: { value: new THREE.Color(SKY.day.top) }, bottom: { value: new THREE.Color(SKY.day.bottom) } }), []);
  const stars = useRef<THREE.PointsMaterial>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const starGeo = useMemo(() => {
    const pts: number[] = [];
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const th = r() * Math.PI * 2;
      const ph = r() * Math.PI * 0.45;
      pts.push(70 * Math.sin(ph) * Math.cos(th), 70 * Math.cos(ph), 70 * Math.sin(ph) * Math.sin(th));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useEffect(() => {
    scene.fog = new THREE.Fog(SKY.day.fog, 28, 70);
  }, [scene]);
  useFrame(() => {
    const k = SKY[phase];
    uniforms.top.value.lerp(new THREE.Color(k.top), 0.03);
    uniforms.bottom.value.lerp(new THREE.Color(k.bottom), 0.03);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.lerp(new THREE.Color(k.fog), 0.03);
    if (sun.current) sun.current.intensity += (k.sun - sun.current.intensity) * 0.03;
    if (hemi.current) hemi.current.intensity += (k.hemi - hemi.current.intensity) * 0.03;
    if (stars.current) stars.current.opacity += ((phase === "night" ? 0.9 : phase === "heating" ? 0.25 : 0) - stars.current.opacity) * 0.03;
  });
  return (
    <>
      <mesh scale={90}>
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          uniforms={uniforms}
          vertexShader="varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }"
          fragmentShader="uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*0.5+0.5,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,1.3)),1.0); }"
        />
      </mesh>
      <points geometry={starGeo}>
        <pointsMaterial ref={stars} color="#ffffff" size={0.35} sizeAttenuation transparent opacity={0} fog={false} depthWrite={false} />
      </points>
      <hemisphereLight ref={hemi} args={["#cfe6ff", "#3a4a2a", 0.9]} />
      <directionalLight
        ref={sun}
        position={[9, 14, 7]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
    </>
  );
}

/** A tree whose sway follows the measured wind speed (direction is not in the data, so it only rocks). */
function Tree({ position, scale, index, wind }: { position: [number, number, number]; scale: number; index: number; wind: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const smooth = useRef(0);
  useFrame(({ clock }) => {
    if (!group.current) return;
    smooth.current += ((wind.current ?? 0) - smooth.current) * 0.05;
    const strength = Math.min(smooth.current, 12) / 12;
    const t = clock.elapsedTime * (1.1 + strength * 1.6) + index * 1.7;
    const gust = Math.sin(t) * 0.6 + Math.sin(t * 2.3) * 0.25;
    group.current.rotation.z = strength * (0.05 + 0.07 * gust);
    group.current.rotation.x = strength * 0.035 * Math.sin(t * 0.8 + index);
  });
  return (
    <group ref={group} position={position} scale={scale}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.8, 8]} />
        <meshStandardMaterial color="#5a3d26" roughness={1} />
      </mesh>
      <mesh position={[0, 2.4, 0]} castShadow>
        <icosahedronGeometry args={[1.1, 1]} />
        <meshStandardMaterial color="#3f6b35" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.4, 2.0, 0.3]} castShadow>
        <icosahedronGeometry args={[0.75, 1]} />
        <meshStandardMaterial color="#4b7a3c" roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function Garden({ grass, paving, wind }: { grass: THREE.Texture; paving: THREE.Texture; wind: React.RefObject<number> }) {
  const [dx, dz] = w(257, 631);
  const trees: [number, number, number][] = [
    [-6.5, -4.5, 1.2],
    [6.8, -2.5, 1],
    [-5.8, 5.5, 0.9],
    [7.2, 5.2, 1.3],
  ];
  const bushes: [number, number][] = [
    [-4.2, 4.3],
    [-3.6, 4.6],
    [4.6, 3.9],
    [5.1, 3.5],
    [4.6, -4.4],
  ];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[40, 64]} />
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[dx, 0.005, dz + 2.6]} receiveShadow>
        <planeGeometry args={[1.1, 4.8]} />
        <meshStandardMaterial map={paving} roughness={0.95} />
      </mesh>
      {trees.map(([x, z, sc], i) => (
        <Tree key={i} position={[x, 0, z]} scale={sc} index={i} wind={wind} />
      ))}
      {bushes.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.35, z]} castShadow>
          <icosahedronGeometry args={[0.45, 1]} />
          <meshStandardMaterial color="#456f37" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/* --------------------------------------------------------------- rooms */

const THERMAL = THERMAL_STOPS.map((c) => new THREE.Color(c));
export function thermalColor(temp: number, lo: number, hi: number): THREE.Color {
  const t = Math.min(1, Math.max(0, hi > lo ? (temp - lo) / (hi - lo) : 0.5)) * (THERMAL.length - 1);
  const i = Math.min(THERMAL.length - 2, Math.floor(t));
  return THERMAL[i].clone().lerp(THERMAL[i + 1], t - i);
}

function Partitions({ rect }: { rect: Rect }) {
  const pieces = useMemo(
    () => [
      ...wallRun("h", rect.y, rect.x, rect.x + rect.w, INT / 2, INT, CEIL),
      ...wallRun("h", rect.y + rect.h, rect.x, rect.x + rect.w, -INT / 2, INT, CEIL),
      ...wallRun("v", rect.x, rect.y, rect.y + rect.h, INT / 2, INT, CEIL),
      ...wallRun("v", rect.x + rect.w, rect.y, rect.y + rect.h, -INT / 2, INT, CEIL),
    ],
    [rect],
  );
  return (
    <group>
      {pieces.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow receiveShadow>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color="#efe9df" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Furniture({ id }: { id: TwinRoomId | "bathroom" }) {
  const B = (p: [number, number, number], s: [number, number, number], c: string) => (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.8} />
    </mesh>
  );
  switch (id) {
    case "bedroom_1":
      return (
        <group>
          {B([0.1, 0.25, -0.55], [1.45, 0.5, 2.0], "#e9e4da")}
          {B([0.1, 0.55, -1.5], [1.5, 0.6, 0.08], "#6b4a33")}
          {B([0.1, 0.52, 0.15], [1.4, 0.06, 0.6], "#5b7fa8")}
          {B([-1.15, 0.95, 1.2], [0.6, 1.9, 1.1], "#8a6a4d")}
          {B([0.1, 0.01, 0.9], [1.6, 0.02, 1.0], "#a8584a")}
        </group>
      );
    case "living_room":
      return (
        <group>
          {B([-0.95, 0.4, 0.2], [0.85, 0.8, 2.1], "#4f6273")}
          {B([0.1, 0.22, 0.2], [0.6, 0.44, 1.0], "#7a5a3e")}
          {B([1.3, 0.3, 0.2], [0.35, 0.6, 1.4], "#2e3238")}
          {B([1.32, 0.95, 0.2], [0.06, 0.7, 1.2], "#111418")}
          {B([0, 0.01, 0.2], [2.2, 0.02, 2.6], "#c8b48f")}
        </group>
      );
    case "kitchen":
      return (
        <group>
          {B([0.2, 0.45, -0.55], [2.3, 0.9, 0.6], "#dfe3e6")}
          {B([0.2, 0.92, -0.55], [2.3, 0.04, 0.62], "#3a3f45")}
          {B([-1.25, 0.9, -0.5], [0.6, 1.8, 0.65], "#cfd5da")}
        </group>
      );
    case "bathroom":
      return (
        <group>
          {B([-0.5, 0.3, -0.4], [0.7, 0.55, 1.65], "#f4f6f7")}
          {B([0.45, 0.25, 0.9], [0.4, 0.45, 0.55], "#f4f6f7")}
        </group>
      );
    default:
      return null;
  }
}

function Room({
  id,
  reading,
  thermal,
  heatView,
  selected,
  hovered,
  onSelect,
  onHover,
  wood,
  warmLight,
}: {
  id: TwinRoomId;
  reading: Reading | undefined;
  thermal: [number, number];
  heatView: boolean;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  wood: THREE.Texture;
  warmLight: boolean;
}) {
  const r = PLAN_ROOMS[id];
  const [cx, cz] = w(r.x + r.w / 2, r.y + r.h / 2);
  const W = r.w / 100;
  const D = r.h / 100;
  const color = useMemo(
    () => (reading?.temp != null ? thermalColor(reading.temp, thermal[0], thermal[1]) : new THREE.Color("#444")),
    [reading?.temp, thermal],
  );
  const floorTex = useMemo(() => {
    const t = wood.clone();
    t.needsUpdate = true;
    t.repeat.set(W / 1.2, D / 1.2);
    return t;
  }, [wood, W, D]);
  return (
    <group>
      <group position={[cx, 0, cz]}>
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[W, 0.04, D]} />
          <meshStandardMaterial map={id === "kitchen" ? undefined : floorTex} color={id === "kitchen" ? "#d9d4cc" : "#ffffff"} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.045, 0]} visible={heatView}>
          <boxGeometry args={[W - 0.02, 0.01, D - 0.02]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.8} />
        </mesh>
        <Furniture id={id} />
        <mesh
          position={[0, CEIL / 2, 0]}
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
          <boxGeometry args={[W - 0.16, CEIL - 0.05, D - 0.16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            transparent
            opacity={heatView ? 0.22 + (hovered ? 0.08 : 0) : 0}
            depthWrite={false}
          />
          {(selected || hovered) && <Edges color="#ffffff" lineWidth={selected ? 2 : 1} />}
        </mesh>
        {warmLight && <pointLight position={[0, 2.0, 0]} color="#ffb366" intensity={6} distance={5} decay={1.6} />}
      </group>
      <Partitions rect={r} />
    </group>
  );
}

/* ------------------------------------------------------------- effects */

function ProblemEffect({ room, problem, active }: { room: TwinRoomId; problem: Exclude<Problem, null>; active: boolean }) {
  const r = PLAN_ROOMS[room];
  const [cx, cz] = w(r.x + r.w / 2, r.y + r.h / 2);
  const W = r.w / 100;
  const D = r.h / 100;
  const N = 70;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const state = useMemo(() => {
    let s = 9;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: N }, (_, i) => ({ phase: i / N, side: Math.floor(rand() * 4), along: rand(), h: 0.3 + rand() * 1.9, speed: 0.12 + rand() * 0.1, kind: problem === "unsure" ? (i % 2 ? "draft" : "envelope_conduction") : problem }));
  }, [problem]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const arr = new Float32Array(N * 3);
    state.forEach((p, i) => new THREE.Color(p.kind === "draft" ? "#8fd3ff" : "#ff8f3a").toArray(arr, i * 3));
    return arr;
  }, [state]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) {
      const k = (t * 0.7) % 1;
      ring.current.scale.setScalar(0.6 + k * 0.9);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = active ? 0.7 * (1 - k) : 0;
    }
    if (!mesh.current) return;
    state.forEach((p, i) => {
      const k = (p.phase + t * p.speed) % 1;
      // Point on the room perimeter (0..3 = sides) and its outward normal.
      const along = p.along - 0.5;
      const edge: [number, number, number, number][] = [
        [along * W, -D / 2, 0, -1],
        [W / 2, along * D, 1, 0],
        [along * W, D / 2, 0, 1],
        [-W / 2, along * D, -1, 0],
      ];
      const [ex, ez, nx, nz] = edge[p.side];
      let x: number, z: number, y: number;
      if (p.kind === "draft") {
        // cold air streams in from outside the wall towards the middle
        const d = 1.2 - k * 1.9;
        x = ex + nx * d * (d > 0 ? 1 : 0.4);
        z = ez + nz * d * (d > 0 ? 1 : 0.4);
        y = p.h - k * 0.4;
      } else {
        // heat seeps out through the wall and rises
        const d = -0.3 + k * 1.6;
        x = ex + nx * d;
        z = ez + nz * d;
        y = p.h + k * 1.2;
      }
      const fade = Math.sin(Math.PI * k);
      dummy.position.set(cx + x, y, cz + z);
      dummy.scale.setScalar(active ? 0.05 + 0.06 * fade : 0);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
        <sphereGeometry args={[1, 10, 10]}>
          <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
        </sphereGeometry>
        <meshBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} />
      </instancedMesh>
      <mesh ref={ring} position={[cx, 0.06, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(W, D) * 0.42, Math.min(W, D) * 0.48, 48]} />
        <meshBasicMaterial color="#ff4d4d" transparent opacity={0.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function FanSpinner({ on }: { on: boolean }) {
  const blades = useRef<THREE.Group>(null);
  const r = PLAN_ROOMS.bedroom_2;
  const [x, z] = w(r.x + r.w / 2, r.y + 30);
  useFrame((_, dt) => {
    if (blades.current && on) blades.current.rotation.y += dt * 14;
  });
  if (!on) return null;
  return (
    <group position={[x, CEIL - 0.08, z]}>
      <mesh>
        <cylinderGeometry args={[0.18, 0.18, 0.05, 24]} />
        <meshStandardMaterial color="#e8eef2" />
      </mesh>
      <group ref={blades} position={[0, -0.04, 0]}>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} rotation={[0, (k * Math.PI) / 2, 0]} position={[0, 0, 0]}>
            <boxGeometry args={[0.32, 0.01, 0.06]} />
            <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* -------------------------------------------------------------- camera */

const CAMS: Record<CameraView, { pos: [number, number, number]; target: [number, number, number] }> = {
  outside: { pos: [10.5, 6.2, 12.5], target: [0, 1.4, 0] },
  inside: { pos: [5.5, 12.5, 9.5], target: [0, 0.6, 0.3] },
};

function CameraRig({ view, nonce, controls }: { view: CameraView; nonce: number; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, size } = useThree();
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const f = size.width / Math.max(1, size.height) < 1.2 ? 1.35 : 1;
    goal.current = { pos: new THREE.Vector3(...CAMS[view].pos).multiplyScalar(f), target: new THREE.Vector3(...CAMS[view].target) };
  }, [view, nonce, size.width, size.height]);
  useFrame(() => {
    if (!goal.current) return;
    camera.position.lerp(goal.current.pos, 0.05);
    controls.current?.target.lerp(goal.current.target, 0.05);
    controls.current?.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.03) goal.current = null;
  });
  return null;
}

/* -------------------------------------------------------------- labels */

const ANCHORS = Object.fromEntries(
  TWIN_ORDER.map((id) => {
    const r = PLAN_ROOMS[id];
    const [x, z] = w(r.x + r.w / 2, r.y + r.h / 2);
    return [id, new THREE.Vector3(x, CEIL + 0.5, z)];
  }),
) as Record<TwinRoomId, THREE.Vector3>;

function LabelProjector({ refs }: { refs: React.RefObject<Record<string, HTMLDivElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const id of TWIN_ORDER) {
      const el = refs.current?.[id];
      if (!el) continue;
      v.copy(ANCHORS[id]).project(camera);
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    }
  });
  return null;
}

/* --------------------------------------------------------------- scene */

export interface HouseProps {
  phase: Phase;
  roofOpen: boolean;
  heatView: boolean;
  readings: Partial<Record<TwinRoomId, Reading>>;
  thermal: [number, number];
  showLabels: boolean;
  problemRoom: TwinRoomId | null;
  problem: Problem;
  fixedRoom: TwinRoomId | null;
  truthRoom: TwinRoomId | null;
  fanOn: boolean;
  selected: TwinRoomId | null;
  onSelect: (id: TwinRoomId) => void;
  autoRotate: boolean;
  view: CameraView;
  viewNonce: number;
  height: number | string;
  /** Measured wind speed (m/s) at the current playback time; drives tree sway. */
  windSpeed?: number | null;
}

export default function RealisticHouse(props: HouseProps) {
  const { phase, roofOpen, heatView, readings, thermal, showLabels, problemRoom, problem, fixedRoom, truthRoom, fanOn, selected, onSelect, autoRotate, view, viewNonce, height, windSpeed } = props;
  const wind = useRef(windSpeed ?? 1.5);
  wind.current = windSpeed ?? 1.5;
  const tex = useMemo(() => ({ brick: brickTexture(), roof: roofTexture(), grass: grassTexture(), wood: woodTexture(), paving: pavingTexture() }), []);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const [hover, setHover] = useState<TwinRoomId | null>(null);
  const paused = useAnyModalOpen();

  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hover]);

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ height }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop={paused ? "never" : "always"}
        camera={{ position: [16, 9, 18], fov: 36, near: 0.1, far: 200 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        aria-label="Interactive 3D illustration of the example home"
      >
        <Sky phase={phase} />
        <Garden grass={tex.grass} paving={tex.paving} wind={wind} />
        <ExteriorWalls brick={tex.brick} />
        <Openings phase={phase} />
        {TWIN_ORDER.map((id) => (
          <Room
            key={id}
            id={id}
            reading={readings[id]}
            thermal={thermal}
            heatView={heatView}
            selected={selected === id}
            hovered={hover === id}
            onSelect={() => onSelect(id)}
            onHover={(on) => setHover((h) => (on ? id : h === id ? null : h))}
            wood={tex.wood}
            warmLight={phase === "heating"}
          />
        ))}
        {PLAN_UNMODELED.map(({ label, rect }) => {
          const [cx, cz] = w(rect.x + rect.w / 2, rect.y + rect.h / 2);
          return (
            <group key={label}>
              <mesh position={[cx, 0.02, cz]} receiveShadow>
                <boxGeometry args={[rect.w / 100, 0.04, rect.h / 100]} />
                <meshStandardMaterial color={label === "Bathroom" ? "#cfd8dc" : "#b9ada0"} roughness={0.8} />
              </mesh>
              {label === "Bathroom" && (
                <group position={[cx, 0, cz]}>
                  <Furniture id="bathroom" />
                </group>
              )}
              <Partitions rect={rect} />
            </group>
          );
        })}
        <FanSpinner on={fanOn} />
        {problemRoom && problem && <ProblemEffect key={`${problemRoom}-${problem}`} room={problemRoom} problem={problem} active={roofOpen} />}
        <Roof open={roofOpen} roofTex={tex.roof} brick={tex.brick} />
        <OrbitControls
          ref={controls}
          enableDamping
          dampingFactor={0.07}
          enablePan={false}
          minDistance={7}
          maxDistance={34}
          minPolarAngle={0.1}
          maxPolarAngle={1.42}
          target={[0, 1.2, 0]}
          autoRotate={autoRotate}
          autoRotateSpeed={0.5}
        />
        <CameraRig view={view} nonce={viewNonce} controls={controls} />
        <LabelProjector refs={labels} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {TWIN_ORDER.map((id) => {
          const temp = readings[id]?.temp;
          const isProblem = problemRoom === id;
          return (
            <div
              key={id}
              ref={(el) => {
                labels.current[id] = el;
              }}
              className={`absolute left-0 top-0 transition-opacity duration-500 ${showLabels ? "opacity-100" : "opacity-0"}`}
              style={{ transform: "translate(-9999px,-9999px)" }}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`whitespace-nowrap rounded-2xl border px-3 py-1.5 text-center shadow-xl backdrop-blur-md ${
                    isProblem ? "border-red-400/70 bg-[#2a0f12]/85" : selected === id ? "border-white/60 bg-black/60" : "border-white/15 bg-black/45"
                  }`}
                >
                  <div className="text-[11.5px] font-medium text-white/90">{TWIN_ROOMS[id].name}</div>
                  <div className="text-[17px] font-semibold leading-tight text-white">{temp != null ? `${fmt(temp)}°` : "—"}</div>
                  {isProblem && <div className="mt-0.5 text-[11px] font-semibold text-red-300">{problem === "unsure" ? "? Losing heat" : "⚠ Problem here"}</div>}
                  {fixedRoom === id && <div className="mt-0.5 text-[11px] font-semibold text-emerald-300">✓ Fixed</div>}
                  {truthRoom === id && <div className="mt-0.5 text-[11px] font-semibold text-amber-300">★ Hidden problem</div>}
                </div>
                <div className={`h-3 w-px ${isProblem ? "bg-red-400/70" : "bg-white/40"}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
