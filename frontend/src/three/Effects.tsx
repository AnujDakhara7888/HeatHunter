import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { planBounds, roomCenter } from "../lib/plan";
import { useScene } from "../store/scene";
import { outwardNormal, wallPieces } from "./geometry";

const dot = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.6)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

/** Plan-space unit vector (x, z) for a compass bearing, given the bearing the plan's +z faces. */
export function bearingToPlan(bearing: number, zBearing: number): [number, number] {
  const a = ((bearing - zBearing) * Math.PI) / 180;
  return [-Math.sin(a), Math.cos(a)];
}

/**
 * Wind streaks blowing past the house. Speed follows the measured wind; the
 * direction follows the measured wind direction when the night has one,
 * relative to the house's documented orientation.
 */
export function Wind() {
  const plan = useScene((s) => s.plan);
  const wind = useScene((s) => s.wind);
  const windFrom = useScene((s) => s.windFrom);
  const zBearing = useScene((s) => s.zBearing);
  const view = useScene((s) => s.view);
  const b = useMemo(() => planBounds(plan), [plan]);
  const COUNT = 140;
  const LEN = 1.6;
  const state = useMemo(() => {
    const span = Math.max(b.w, b.d) * 4 + 16;
    return Array.from({ length: COUNT }, (_, i) => ({
      u: -span / 2 + Math.random() * span,
      w: -span / 2 + Math.random() * span,
      y: 0.3 + Math.random() * (i % 3 === 0 ? 6 : 3.4),
      speed: 0.6 + Math.random() * 0.8,
      phase: Math.random() * 10,
      span,
    }));
  }, [b]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3));
    const col = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) col.set([0.25, 0.4, 0.7, 0.75, 0.88, 1], i * 6);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  const dir = useRef<[number, number]>([1, 0]);
  const mat = useRef<THREE.LineBasicMaterial>(null);
  useFrame((st, dt) => {
    const speed = Math.max(0.6, wind ?? 2);
    // ease the streak direction toward the measured one so changes read as a gust, not a jump
    const target = windFrom != null && zBearing != null ? bearingToPlan(windFrom + 180, zBearing) : ([1, 0] as [number, number]);
    const k = 1 - Math.exp(-dt * 1.5);
    let [dx, dz] = [dir.current[0] + (target[0] - dir.current[0]) * k, dir.current[1] + (target[1] - dir.current[1]) * k];
    const n = Math.hypot(dx, dz) || 1;
    dx /= n;
    dz /= n;
    dir.current = [dx, dz];
    const px = -dz;
    const pz = dx;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const p = state[i];
      p.u += dt * p.speed * speed * 1.6;
      if (p.u > p.span / 2) p.u -= p.span;
      const x = b.cx + dx * p.u + px * p.w;
      const z = b.cz + dz * p.u + pz * p.w;
      const inside = x > b.minX - 0.6 && x < b.maxX + 0.6 && z > b.minZ - 0.6 && z < b.maxZ + 0.6 && p.y < 3.6;
      const y = inside ? 3.9 + (p.y % 1) : p.y;
      const wob = Math.sin(st.clock.elapsedTime * 1.4 + p.phase) * 0.08;
      const len = LEN * (0.5 + speed * 0.08);
      pos.setXYZ(i * 2, x - dx * len, y + wob, z - dz * len);
      pos.setXYZ(i * 2 + 1, x + px * wob, y + wob, z + pz * wob);
    }
    pos.needsUpdate = true;
    if (mat.current) mat.current.opacity = THREE.MathUtils.damp(mat.current.opacity, view === "inside" ? 0 : view === "thermal" ? 0.25 : 0.55, 3, dt);
  });
  return (
    <lineSegments geometry={geo} frustumCulled={false}>
      <lineBasicMaterial ref={mat} vertexColors transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
  );
}

/** Ground compass, shown when the house orientation is documented. */
export function Compass() {
  const plan = useScene((s) => s.plan);
  const zBearing = useScene((s) => s.zBearing);
  const windFrom = useScene((s) => s.windFrom);
  const view = useScene((s) => s.view);
  const b = useMemo(() => planBounds(plan), [plan]);
  if (zBearing == null || view === "inside") return null;
  const c: [number, number] = [b.maxX + 1.6, b.minZ - 1.2];
  const r = 0.9;
  const [nx, nz] = bearingToPlan(0, zBearing);
  const wind = windFrom != null ? bearingToPlan(windFrom, zBearing) : null;
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return new THREE.Vector3(c[0] + Math.cos(a) * r, 0.03, c[1] + Math.sin(a) * r);
  });
  return (
    <group>
      <Line points={ring} color="#ffffff" transparent opacity={0.35} lineWidth={1} />
      <Line points={[[c[0], 0.03, c[1]], [c[0] + nx * r, 0.03, c[1] + nz * r]]} color="#ffffff" lineWidth={2} />
      {wind && <Line points={[[c[0] + wind[0] * r * 1.6, 0.04, c[1] + wind[1] * r * 1.6], [c[0] + wind[0] * r * 0.3, 0.04, c[1] + wind[1] * r * 0.3]]} color="#7fb6ff" lineWidth={3} />}
      <Html position={[c[0] + nx * (r + 0.35), 0.05, c[1] + nz * (r + 0.35)]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <span style={{ font: "600 12px Inter Variable, sans-serif", color: "#fff" }}>N</span>
      </Html>
      {wind && (
        <Html position={[c[0] + wind[0] * r * 2, 0.05, c[1] + wind[1] * r * 2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <span style={{ font: "500 10.5px Inter Variable, sans-serif", color: "#9cc8ff", whiteSpace: "nowrap" }}>wind from {Math.round(windFrom!)}°</span>
        </Html>
      )}
    </group>
  );
}

const fluxVertex = /* glsl */ `
  attribute vec3 aStart; attribute vec3 aDir; attribute float aOffset;
  uniform float uTime; uniform float uSize; uniform float uTravel; uniform float uRise;
  varying float vProg;
  void main(){
    float prog = fract(uTime*0.22 + aOffset);
    vProg = prog;
    vec3 p = aStart + aDir*prog*uTravel + vec3(0., prog*uRise, 0.) + vec3(sin(prog*9.+aOffset*20.)*.05, 0., cos(prog*7.+aOffset*13.)*.05);
    vec4 mv = modelViewMatrix*vec4(p,1.);
    gl_PointSize = uSize*(1.-prog*.4)*(300./-mv.z);
    gl_Position = projectionMatrix*mv;
  }`;
const fluxFragment = /* glsl */ `
  uniform sampler2D uMap; uniform vec3 uFrom; uniform vec3 uTo; uniform float uAlpha;
  varying float vProg;
  void main(){
    vec4 t = texture2D(uMap, gl_PointCoord);
    vec3 c = mix(uFrom, uTo, smoothstep(0.,.8,vProg));
    float a = t.a*smoothstep(0.,.12,vProg)*(1.-smoothstep(.65,1.,vProg))*uAlpha;
    gl_FragColor = vec4(c*t.rgb, a);
  }`;

/**
 * The engine's finding, made visible: heat leaving through the walls
 * (insulation) or cold air pushing in at the openings (leak).
 */
export function HeatFlux() {
  const plan = useScene((s) => s.plan);
  const finding = useScene((s) => s.finding);
  const view = useScene((s) => s.view);
  const geom = useMemo(() => {
    if (!finding?.cause) return null;
    const segs = wallPieces(plan).segments.filter((s) => s.exterior && s.rooms.includes(finding.room));
    if (!segs.length) return null;
    const N = Math.round(260 + 520 * finding.strength);
    const start = new Float32Array(N * 3);
    const dir = new Float32Array(N * 3);
    const off = new Float32Array(N);
    const draft = finding.cause === "draft";
    const holes = segs.flatMap((s) => s.openings.map((o) => ({ s, o })));
    for (let i = 0; i < N; i++) {
      let x: number, z: number, y: number, n: [number, number];
      if (draft && holes.length) {
        const { s, o } = holes[i % holes.length];
        n = outwardNormal(s, plan);
        const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
        const t = (o.a + Math.random() * (o.b - o.a)) / len;
        x = s.x0 + (s.x1 - s.x0) * t + n[0] * 1.4;
        z = s.z0 + (s.z1 - s.z0) * t + n[1] * 1.4;
        y = o.kind === "window" ? 0.9 + Math.random() * 1.2 : 0.05 + Math.random() * 1.9;
        dir.set([-n[0], 0, -n[1]], i * 3);
      } else {
        const s = segs[i % segs.length];
        n = outwardNormal(s, plan);
        const t = Math.random();
        x = s.x0 + (s.x1 - s.x0) * t;
        z = s.z0 + (s.z1 - s.z0) * t;
        y = 0.1 + Math.random() * 2.2;
        dir.set([n[0], 0, n[1]], i * 3);
      }
      start.set([x, y, z], i * 3);
      off[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(start.slice(), 3));
    g.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    g.setAttribute("aOffset", new THREE.BufferAttribute(off, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: draft ? 0.16 : 0.13 },
        uTravel: { value: draft ? 2.6 : 1.9 },
        uRise: { value: draft ? -0.25 : 0.5 },
        uMap: { value: dot },
        uFrom: { value: new THREE.Color(draft ? "#9cd6ff" : "#ff8a3a") },
        uTo: { value: new THREE.Color(draft ? "#ff9a5a" : "#3a6dff") },
        uAlpha: { value: 0 },
      },
      vertexShader: fluxVertex,
      fragmentShader: fluxFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { g, m };
  }, [finding, plan]);
  useFrame((st, dt) => {
    if (!geom) return;
    geom.m.uniforms.uTime.value = st.clock.elapsedTime;
    const target = view === "exterior" || view === "top" ? 0.35 : view === "inside" ? 0.4 : 1;
    geom.m.uniforms.uAlpha.value = THREE.MathUtils.damp(geom.m.uniforms.uAlpha.value, target, 2, dt);
  });
  if (!geom) return null;
  return <points geometry={geom.g} material={geom.m} frustumCulled={false} />;
}

/** Fan test: outside air drawn through every opening toward the extract fan. */
export function Airflow() {
  const plan = useScene((s) => s.plan);
  const fanOn = useScene((s) => s.fanOn);
  const finding = useScene((s) => s.finding);
  const data = useMemo(() => {
    const fanRoom =
      plan.rooms.find((r) => /bath|wc|toilet|shower/i.test(r.name)) ??
      plan.rooms.find((r) => /kitchen/i.test(r.name)) ??
      plan.rooms[0];
    const [fx, fz] = roomCenter(fanRoom);
    const fan = new THREE.Vector3(fx, 1.9, fz);
    const curves: { curve: THREE.CatmullRomCurve3; strong: boolean }[] = [];
    for (const s of wallPieces(plan).segments.filter((x) => x.exterior)) {
      const room = plan.rooms.find((r) => r.room_id === s.rooms[0]);
      if (!room) continue;
      const n = outwardNormal(s, plan);
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      for (const o of s.openings) {
        const t = (o.a + o.b) / 2 / len;
        const ox = s.x0 + (s.x1 - s.x0) * t;
        const oz = s.z0 + (s.z1 - s.z0) * t;
        const y = o.kind === "window" ? 1.5 : 1.0;
        const [rx, rz] = roomCenter(room);
        const pts = [
          new THREE.Vector3(ox + n[0] * 2.2, y + 0.4, oz + n[1] * 2.2),
          new THREE.Vector3(ox, y, oz),
          new THREE.Vector3((ox + rx) / 2, 1.0, (oz + rz) / 2),
          new THREE.Vector3(rx, 0.9, rz),
          new THREE.Vector3((rx + fx) / 2, 1.2, (rz + fz) / 2),
          fan,
        ];
        curves.push({ curve: new THREE.CatmullRomCurve3(pts), strong: finding?.cause === "draft" && room.room_id === finding.room });
      }
    }
    const P = 26;
    const positions = new Float32Array(curves.length * P * 3);
    const colors = new Float32Array(curves.length * P * 3);
    curves.forEach((c, i) => {
      for (let k = 0; k < P; k++) colors.set(c.strong ? [0.6, 0.9, 1] : [0.35, 0.65, 1], (i * P + k) * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { fan, curves, g, P };
  }, [plan, finding]);
  const mat = useRef<THREE.PointsMaterial>(null);
  const tubes = useRef<THREE.Group>(null);
  const fanMesh = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    const on = fanOn ? 1 : 0;
    if (mat.current) mat.current.opacity = THREE.MathUtils.damp(mat.current.opacity, on, 3, dt);
    if (tubes.current) tubes.current.visible = (mat.current?.opacity ?? 0) > 0.05;
    if (fanMesh.current) fanMesh.current.rotation.y += dt * 12 * on;
    if (!fanOn) return;
    const pos = data.g.attributes.position as THREE.BufferAttribute;
    data.curves.forEach((c, i) => {
      for (let k = 0; k < data.P; k++) {
        const u = (st.clock.elapsedTime * (c.strong ? 0.16 : 0.1) + k / data.P) % 1;
        const p = c.curve.getPointAt(u);
        pos.setXYZ(i * data.P + k, p.x, p.y, p.z);
      }
    });
    pos.needsUpdate = true;
  });
  return (
    <group>
      <group ref={tubes}>
        {data.curves.map((c, i) => (
          <mesh key={i}>
            <tubeGeometry args={[c.curve, 60, c.strong ? 0.035 : 0.014, 6, false]} />
            <meshBasicMaterial color={c.strong ? "#9fdcff" : "#4f86c6"} transparent opacity={c.strong ? 0.6 : 0.3} depthWrite={false} />
          </mesh>
        ))}
        <mesh ref={fanMesh} position={data.fan}>
          <cylinderGeometry args={[0.28, 0.28, 0.06, 6]} />
          <meshBasicMaterial color="#e8f6ff" />
        </mesh>
      </group>
      <points geometry={data.g} frustumCulled={false}>
        <pointsMaterial ref={mat} size={0.12} map={dot ?? undefined} vertexColors transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  );
}
