import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HomePlan } from "../api/types";
import { planBounds, roomCenter } from "../lib/plan";
import { displayName, tempRGB } from "../lib/rooms";
import { useScene } from "../store/scene";
import { WALL_H, WALL_T, outwardNormal, roofLayout, wallPieces } from "./geometry";
import { createThermalMaterial } from "./thermal";

const LOWERED = 0.46;

function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

/** Canvas heat map of room temperatures, blurred like a thermal image and clipped to the rooms. */
function useHeatTexture(plan: HomePlan) {
  const { canvas, scratch, texture, scale } = useMemo(() => {
    const b = planBounds(plan);
    const scale = Math.min(110, 900 / Math.max(b.w, b.d));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(b.w * scale);
    canvas.height = Math.ceil(b.d * scale);
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, scratch, texture, scale };
  }, [plan]);
  const temps = useScene((s) => s.temps);
  const range = useScene((s) => s.tempRange);
  const finding = useScene((s) => s.finding);
  useEffect(() => {
    const b = planBounds(plan);
    const g = scratch.getContext("2d")!;
    g.clearRect(0, 0, scratch.width, scratch.height);
    for (const r of plan.rooms) {
      const t = temps[r.room_id];
      const [cr, cg, cb] = t == null ? [70, 74, 84] : tempRGB(t, range[0], range[1]);
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect((r.x - b.minX) * scale, (r.z - b.minZ) * scale, r.width * scale, r.depth * scale);
    }
    if (finding) {
      const room = plan.rooms.find((r) => r.room_id === finding.room);
      const t = temps[finding.room];
      if (room && t != null) {
        // cold sink along the room's leaking walls
        for (const seg of wallPieces(plan).segments.filter((s) => s.exterior && s.rooms.includes(room.room_id))) {
          const mx = ((seg.x0 + seg.x1) / 2 - b.minX) * scale;
          const mz = ((seg.z0 + seg.z1) / 2 - b.minZ) * scale;
          const rad = Math.max(Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0), 1) * scale * 0.7;
          const grd = g.createRadialGradient(mx, mz, 0, mx, mz, rad);
          const [cr, cg, cb] = tempRGB(t - 2.5 * finding.strength, range[0], range[1]);
          grd.addColorStop(0, `rgba(${cr},${cg},${cb},0.95)`);
          grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          g.fillStyle = grd;
          g.fillRect(0, 0, scratch.width, scratch.height);
        }
      }
    }
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.beginPath();
    for (const r of plan.rooms) c.rect((r.x - b.minX) * scale, (r.z - b.minZ) * scale, r.width * scale, r.depth * scale);
    c.clip();
    c.filter = `blur(${Math.round(scale * 0.32)}px)`;
    c.drawImage(scratch, 0, 0);
    c.filter = "none";
    c.globalAlpha = 0.55;
    c.drawImage(scratch, 0, 0);
    c.restore();
    texture.needsUpdate = true;
  }, [temps, range, finding, plan, canvas, scratch, texture, scale]);
  return texture;
}

function Furniture() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a7a49d", roughness: 0.9 }), []);
  const soft = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6c7a91", roughness: 1 }), []);
  const F = (x0: number, z0: number, x1: number, z1: number, h: number, m = mat, y = 0) => (
    <mesh position={[(x0 + x1) / 2, y + h / 2, (z0 + z1) / 2]} castShadow receiveShadow material={m} key={`${x0}${z0}${h}`}>
      <boxGeometry args={[x1 - x0, h, z1 - z0]} />
    </mesh>
  );
  return (
    <group>
      {F(0.3, 0.45, 1.9, 2.5, 0.48, soft)}
      {F(0.3, 0.3, 1.9, 0.45, 0.9)}
      {F(2.4, 0.3, 2.95, 0.8, 0.5)}
      {F(5.35, 2.6, 6.1, 4.7, 0.42, soft)}
      {F(5.35, 2.6, 6.1, 2.85, 0.8, soft)}
      {F(3.9, 4.0, 4.9, 4.6, 0.42)}
      {F(3.2, 0.06, 3.75, 1.75, 0.9)}
      {F(5.6, 0.06, 6.2, 1.2, 0.9)}
      {F(0.06, 4.75, 0.76, 6.45, 0.55, mat)}
      {F(3.18, 3.3, 3.4, 4.3, 1.1)}
    </group>
  );
}

function RoomLabel({ id, position }: { id: string; position: [number, number, number] }) {
  const t = useScene((s) => s.temps[id]);
  const rate = useScene((s) => s.rates[id]);
  const names = useScene((s) => s.names);
  const flagged = useScene((s) => s.finding?.room === id);
  const range = useScene((s) => s.tempRange);
  const color = t == null ? "#8a90a2" : `rgb(${tempRGB(t, range[0], range[1]).join(",")})`;
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className={`room-chip ${flagged ? "room-chip--alert" : ""}`}>
        <span className="room-chip__name">
          <i style={{ background: color }} />
          {displayName(id, names)}
        </span>
        <b>{t == null ? "no sensor" : `${t.toFixed(1)}°`}</b>
        {rate != null && <span className="room-chip__rate">{rate.toFixed(2)}°/h</span>}
      </div>
    </Html>
  );
}

export function House() {
  const plan = useScene((s) => s.plan);
  const view = useScene((s) => s.view);
  const labels = useScene((s) => s.labels);
  const temps = useScene((s) => s.temps);
  const finding = useScene((s) => s.finding);
  const focus = useScene((s) => s.focusRoom);
  const thermal = view === "thermal";
  const lowered = view === "open" || view === "fan" || view === "top";
  const isHH09 = plan.plan_id === "smeter-hh09";

  const geo = useMemo(() => wallPieces(plan), [plan]);
  const roof = useMemo(() => roofLayout(plan), [plan]);
  const bounds = useMemo(() => planBounds(plan), [plan]);
  const heat = useHeatTexture(plan);

  const mats = useMemo(
    () => ({
      ext: new THREE.MeshStandardMaterial({ color: "#c79f80", roughness: 0.92 }),
      int: new THREE.MeshStandardMaterial({ color: "#efebe4", roughness: 0.95 }),
      cap: new THREE.MeshBasicMaterial({ color: "#cfd3db", transparent: true, opacity: 0 }),
      roof: new THREE.MeshStandardMaterial({ color: "#2c313b", roughness: 0.75, transparent: true, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({
        color: "#0e1726",
        emissive: new THREE.Color("#ffbf73"),
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
      tExt: createThermalMaterial(0.3),
      tInt: createThermalMaterial(0.36),
      tRoof: createThermalMaterial(0.15),
      tGlass: new THREE.MeshBasicMaterial({ color: "#d1442c", side: THREE.DoubleSide }),
    }),
    [],
  );

  // Feed the engine's finding into the thermal shader.
  useEffect(() => {
    const segs = finding
      ? geo.segments.filter((s) => s.exterior && s.rooms.includes(finding.room)).slice(0, 6)
      : [];
    const spots: THREE.Vector3[] = [];
    if (finding?.cause === "draft") {
      for (const s of segs)
        for (const o of s.openings) {
          const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
          const t = (o.a + o.b) / 2 / len;
          spots.push(new THREE.Vector3(s.x0 + (s.x1 - s.x0) * t, o.kind === "window" ? 1.5 : 1.0, s.z0 + (s.z1 - s.z0) * t));
        }
      if (!spots.length) for (const s of segs) spots.push(new THREE.Vector3((s.x0 + s.x1) / 2, 0.3, (s.z0 + s.z1) / 2));
    }
    for (const m of [mats.tExt, mats.tInt, mats.tRoof]) {
      const conduction = finding?.cause === "envelope_conduction";
      m.uniforms.uSegCount.value = conduction ? segs.length : 0;
      segs.forEach((s, i) => (m.uniforms.uSegs.value[i] as THREE.Vector4).set(s.x0, s.z0, s.x1, s.z1));
      m.uniforms.uSpotCount.value = Math.min(spots.length, 8);
      spots.slice(0, 8).forEach((p, i) => (m.uniforms.uSpots.value[i] as THREE.Vector3).copy(p));
      m.uniforms.uStrength.value = finding ? 0.5 + 0.5 * finding.strength : 0;
    }
  }, [finding, geo, mats]);

  const walls = useRef<THREE.Group>(null);
  const roofGroup = useRef<THREE.Group>(null);
  const floor = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state, dt) => {
    const k = Math.min(dt, 0.5);
    for (const m of [mats.tExt, mats.tInt, mats.tRoof]) m.uniforms.uTime.value = state.clock.elapsedTime;
    if (walls.current) walls.current.scale.y = damp(walls.current.scale.y, lowered ? LOWERED : 1, 4, k);
    if (roofGroup.current) {
      const hide = lowered;
      roofGroup.current.position.y = damp(roofGroup.current.position.y, hide ? 4 : 0, 3, k);
      mats.roof.opacity = damp(mats.roof.opacity, hide ? 0 : 1, 4, k);
      roofGroup.current.visible = mats.roof.opacity > 0.02;
    }
    mats.cap.opacity = damp(mats.cap.opacity, lowered ? 1 : 0, 4, k);
    if (floor.current) floor.current.opacity = damp(floor.current.opacity, thermal || view === "exterior" ? 0 : 1, 3, k);
  });

  const wallMat = (exterior: boolean) => (thermal ? (exterior ? mats.tExt : mats.tInt) : exterior ? mats.ext : mats.int);
  const ridgeAlongX = roof.main.w >= roof.main.d;
  const roofGeo = useMemo(() => {
    const { x, z, w, d } = roof.main;
    const o = 0.3;
    const x0 = x - o, x1 = x + w + o, z0 = z - o, z1 = z + d + o;
    const rise = Math.min(w, d) * 0.32;
    const H = WALL_H;
    const pos = ridgeAlongX
      ? [x0, H, z0, x1, H, z0, x1, H + rise, (z0 + z1) / 2, x0, H, z0, x1, H + rise, (z0 + z1) / 2, x0, H + rise, (z0 + z1) / 2,
         x0, H, z1, x0, H + rise, (z0 + z1) / 2, x1, H + rise, (z0 + z1) / 2, x0, H, z1, x1, H + rise, (z0 + z1) / 2, x1, H, z1]
      : [x0, H, z0, (x0 + x1) / 2, H + rise, z0, (x0 + x1) / 2, H + rise, z1, x0, H, z0, (x0 + x1) / 2, H + rise, z1, x0, H, z1,
         x1, H, z0, x1, H, z1, (x0 + x1) / 2, H + rise, z1, x1, H, z0, (x0 + x1) / 2, H + rise, z1, (x0 + x1) / 2, H + rise, z0];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const gx0 = x, gx1 = x + w, gz0 = z, gz1 = z + d;
    const gable = ridgeAlongX
      ? [gx0, H, gz0, gx0, H, gz1, gx0, H + rise * 0.95, (gz0 + gz1) / 2, gx1, H, gz0, gx1, H + rise * 0.95, (gz0 + gz1) / 2, gx1, H, gz1]
      : [gx0, H, gz0, (gx0 + gx1) / 2, H + rise * 0.95, gz0, gx1, H, gz0, gx0, H, gz1, gx1, H, gz1, (gx0 + gx1) / 2, H + rise * 0.95, gz1];
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(gable, 3));
    gg.computeVertexNormals();
    return { roof: g, gable: gg };
  }, [roof, ridgeAlongX]);

  return (
    <group>
      {/* floor slab + heat map */}
      {plan.rooms.map((r) => (
        <mesh key={r.room_id} position={[r.x + r.width / 2, 0.005, r.z + r.depth / 2]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[r.width, r.depth]} />
          <meshStandardMaterial color={thermal ? "#1d0b33" : "#2a2622"} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[bounds.cx, 0.02, bounds.cz]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[bounds.w, bounds.d]} />
        <meshBasicMaterial ref={floor} map={heat} transparent opacity={0} depthWrite={false} color="#d8d8d8" />
      </mesh>

      <group ref={walls}>
        {geo.walls.map((w, i) => (
          <group key={i} position={[w.cx, 0, w.cz]} rotation-y={w.rot}>
            <mesh position={[0, (w.y0 + w.y1) / 2, 0]} castShadow receiveShadow material={wallMat(w.exterior)}>
              <boxGeometry args={[w.len, w.y1 - w.y0, w.exterior ? WALL_T : WALL_T * 0.7]} />
            </mesh>
            {w.y1 >= WALL_H - 0.01 && !thermal && (
              <mesh position={[0, WALL_H + 0.012, 0]} material={mats.cap}>
                <boxGeometry args={[w.len, 0.024, w.exterior ? WALL_T + 0.004 : WALL_T * 0.7 + 0.004]} />
              </mesh>
            )}
          </group>
        ))}
        {geo.glass.map((g, i) => (
          <mesh key={i} position={[g.cx, (g.y0 + g.y1) / 2, g.cz]} rotation-y={g.rot} material={thermal ? mats.tGlass : mats.glass}>
            <planeGeometry args={[g.len, g.y1 - g.y0]} />
          </mesh>
        ))}
      </group>

      <group ref={roofGroup}>
        <mesh geometry={roofGeo.roof} material={thermal ? mats.tRoof : mats.roof} castShadow />
        <mesh geometry={roofGeo.gable} material={thermal ? mats.tExt : mats.ext} />
        {roof.flats.map((f, i) => (
          <mesh key={i} position={[f.x + f.w / 2, WALL_H + 0.08, f.z + f.d / 2]} material={thermal ? mats.tRoof : mats.roof} castShadow>
            <boxGeometry args={[f.w + 0.3, 0.16, f.d + 0.3]} />
          </mesh>
        ))}
      </group>

      {isHH09 && !thermal && <Furniture />}

      {/* sensors */}
      {!thermal &&
        plan.rooms
          .filter((r) => r.has_sensor !== false)
          .map((r) => {
            const [x, z] = roomCenter(r);
            return (
              <mesh key={r.room_id} position={[x, 0.9, z]}>
                <cylinderGeometry args={[0.07, 0.07, 0.03, 20]} />
                <meshStandardMaterial color="#ffffff" emissive="#2fd18b" emissiveIntensity={1.2} />
              </mesh>
            );
          })}

      {/* warm room lights scale with how warm each room still is */}
      {!thermal &&
        plan.rooms.map((r) => {
          const [x, z] = roomCenter(r);
          const t = temps[r.room_id];
          const warmth = t == null ? 0.3 : THREE.MathUtils.clamp((t - 10) / 12, 0.15, 1);
          return <pointLight key={r.room_id} position={[x, 2.1, z]} color="#ffc27a" intensity={view === "inside" ? 3 * warmth : 2.2 * warmth} distance={5} decay={1.6} />;
        })}

      {labels &&
        !thermal &&
        view !== "exterior" &&
        plan.rooms
          .filter((r) => r.has_sensor !== false && (view !== "inside" || r.room_id === focus || r.room_id === finding?.room))
          .map((r) => {
            const [x, z] = roomCenter(r);
            return <RoomLabel key={r.room_id} id={r.room_id} position={[x, view === "inside" ? 1.95 : WALL_H * LOWERED + 0.75, z]} />;
          })}
    </group>
  );
}

export { outwardNormal };
