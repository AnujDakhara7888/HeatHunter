import { CameraControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { LocateFixed } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { planBounds, roomCenter } from "../lib/plan";
import { useScene, type View } from "../store/scene";
import { CompassHeading, CompassHud } from "./CompassHud";
import { Airflow, HeatFlux, Wind } from "./Effects";
import { RoomHopper, ThermalHud } from "./Overlays";
import { outwardNormal, wallPieces } from "./geometry";
import { House } from "./House";
import { blocked, roomAt } from "./walk";

type Shot = { pos: [number, number, number]; target: [number, number, number] };

function useShot(): Shot {
  const plan = useScene((s) => s.plan);
  const view = useScene((s) => s.view);
  const focus = useScene((s) => s.focusRoom);
  const finding = useScene((s) => s.finding);
  return useMemo(() => {
    const b = planBounds(plan);
    const size = Math.max(b.w, b.d);
    const c: [number, number, number] = [b.cx, 1.1, b.cz];
    const roomId = focus ?? finding?.room ?? null;
    const room = plan.rooms.find((r) => r.room_id === roomId);
    // Face the leaking wall when there is a finding.
    let side: [number, number] = [0.75, 1];
    if (finding && room) {
      const seg = wallPieces(plan).segments.find((s) => s.exterior && s.rooms.includes(room.room_id));
      if (seg) {
        const n = outwardNormal(seg, plan);
        side = [n[0] * 1 + n[1] * 0.55, n[1] * 1 + n[0] * 0.55];
      }
    }
    const shots: Record<View, Shot> = {
      exterior: { pos: [b.cx + size * 1.25, size * 0.55 + 1.2, b.cz + size * 1.55], target: c },
      thermal: { pos: [b.cx + side[0] * size * 1.9, 3.2, b.cz + side[1] * size * 1.9], target: [b.cx, 1.2, b.cz] },
      open: { pos: [b.cx + size * 0.75, size * 1.25 + 2, b.cz + size * 1.05], target: [b.cx, 0, b.cz + 0.3] },
      fan: { pos: [b.cx - size * 0.7, size * 1.3 + 2, b.cz + size * 1.0], target: [b.cx, 0, b.cz + 0.3] },
      top: { pos: [b.cx, size * 1.9 + 2, b.cz + 0.01], target: [b.cx, 0, b.cz] },
      inside: { pos: [b.cx, 1.6, b.cz], target: [b.cx + 1, 1.4, b.cz] },
    };
    if (view === "inside") {
      const r = room ?? plan.rooms.reduce((a, x) => (x.width * x.depth > a.width * a.depth ? x : a), plan.rooms[0]);
      const [rx, rz] = roomCenter(r);
      const outside = wallPieces(plan).segments.filter((s) => s.exterior && s.rooms.includes(r.room_id));
      const score = (s: (typeof outside)[number]) =>
        Math.hypot(s.x1 - s.x0, s.z1 - s.z0) + 3 * s.openings.filter((o) => o.kind === "window").length;
      const seg = [...outside].sort((a, b) => score(b) - score(a))[0];
      // Stand inside the room, near the wall opposite its outside wall, and look at the outside wall.
      const m = 0.22;
      const clampX = (x: number) => Math.min(r.x + r.width - m, Math.max(r.x + m, x));
      const clampZ = (z: number) => Math.min(r.z + r.depth - m, Math.max(r.z + m, z));
      if (seg) {
        const n = outwardNormal(seg, plan);
        const wx = (seg.x0 + seg.x1) / 2;
        const wz = (seg.z0 + seg.z1) / 2;
        // far corner from the wall, offset sideways so the view runs diagonally across the room
        const side = (wx - rx) * n[1] - (wz - rz) * n[0] >= 0 ? -1 : 1;
        const px = clampX(rx - n[0] * r.width + side * n[1] * r.width);
        const pz = clampZ(rz - n[1] * r.depth - side * n[0] * r.depth);
        return { pos: [px, 1.6, pz], target: [wx, 1.15, wz] };
      }
      return { pos: [clampX(r.x + m), 1.55, clampZ(r.z + m)], target: [rx + r.width, 1.2, rz + r.depth] };
    }
    if ((view === "open" || view === "fan") && focus && room) {
      const [rx, rz] = roomCenter(room);
      return { pos: [rx + 6, 11, rz + 8], target: [rx, 0, rz] };
    }
    return shots[view];
  }, [plan, view, focus, finding]);
}

function Rig({ focusRequest }: { focusRequest: number }) {
  const ref = useRef<CameraControls>(null);
  const lastFocusRequest = useRef(0);
  const shot = useShot();
  const view = useScene((s) => s.view);
  const plan = useScene((s) => s.plan);
  const focus = useScene((s) => s.focusRoom);
  const walkTo = useScene((s) => s.walkTo);
  const autoRotate = useScene((s) => s.autoRotate);
  const inset = useScene((s) => s.inset);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const segments = useMemo(() => wallPieces(plan).segments, [plan]);
  const inside = view === "inside";

  // First-person state for walk-in (orbit controls are switched off there).
  const walk = useRef({
    pos: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    yaw: 0,
    goalYaw: 0,
    pitch: -0.08,
    ready: false,
  });
  const walkedInto = useRef<string | null>(null);
  const keys = useRef(new Set<string>());
  const wheel = useRef(0);

  useEffect(() => {
    // Keep the house centred in the space left of a side panel.
    if (inset !== 0 && size.width > 900) camera.setViewOffset(size.width, size.height, inset / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [inset, size, camera]);

  // Orbit views: fly the orbit controls to the shot.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.enabled = !inside;
    camera.fov = inside ? 68 : 38;
    camera.updateProjectionMatrix();
    if (inside) return;
    walk.current.ready = false;
    walkedInto.current = null;
    // resume orbiting from wherever the walk left the camera
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    c.setLookAt(camera.position.x, camera.position.y, camera.position.z, camera.position.x + fwd.x * 3, camera.position.y + fwd.y * 3, camera.position.z + fwd.z * 3, false);
    const refocusing = focusRequest !== lastFocusRequest.current;
    lastFocusRequest.current = focusRequest;
    const availableWidth = size.width - (refocusing && size.width > 900 ? Math.max(0, inset) : 0);
    const aspect = availableWidth / size.height;
    // Leave room for labels and the playback controls when returning to the overview.
    const k = Math.min(1.7, Math.max(refocusing ? 1.3 : 1, 1.5 / aspect));
    const [px, py, pz] = shot.pos;
    const [tx, ty, tz] = shot.target;
    c.setLookAt(tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k, tx, ty, tz, true);
  }, [shot, inside, camera, size.width, size.height, inset, focusRequest]);

  // Walk-in: glide to the room's standing point unless we walked there ourselves.
  useEffect(() => {
    if (!inside) return;
    const w = walk.current;
    if (w.ready && focus && walkedInto.current === focus) return;
    const [px, , pz] = shot.pos;
    const [tx, , tz] = shot.target;
    if (!w.ready) {
      w.pos.copy(camera.position);
      w.yaw = Math.atan2(-(tz - camera.position.z), tx - camera.position.x);
      w.ready = true;
    }
    w.goal.set(px, 1.6, pz);
    w.goalYaw = Math.atan2(-(tz - pz), tx - px);
    // turn the short way round
    while (w.goalYaw - w.yaw > Math.PI) w.goalYaw -= 2 * Math.PI;
    while (w.goalYaw - w.yaw < -Math.PI) w.goalYaw += 2 * Math.PI;
    w.pitch = -0.08;
    walkedInto.current = focus;
  }, [shot, inside, focus, camera]);

  // Double-clicked floor point: walk there.
  useEffect(() => {
    if (!walkTo || !inside) return;
    const room = roomAt(plan, walkTo[0], walkTo[1]);
    if (room) {
      walk.current.goal.set(walkTo[0], 1.6, walkTo[1]);
      walkedInto.current = room;
      useScene.getState().set({ focusRoom: room, walkTo: null });
    } else useScene.getState().set({ walkTo: null });
  }, [walkTo, inside, plan]);

  // Keyboard, wheel and drag-to-look while walking.
  useEffect(() => {
    if (!inside) return;
    const el = gl.domElement;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        keys.current.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const onWheel = (e: WheelEvent) => {
      wheel.current += -e.deltaY * 0.004;
      e.preventDefault();
    };
    let dragging = false;
    const pd = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      const w = walk.current;
      w.goalYaw -= e.movementX * 0.005;
      w.pitch = Math.max(-0.9, Math.min(0.7, w.pitch - e.movementY * 0.004));
    };
    const pu = () => (dragging = false);
    const keySet = keys.current;
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      keySet.clear();
    };
  }, [inside, gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const c = ref.current;
    if (!inside) {
      if (autoRotate && c && !c.active) c.azimuthAngle += dt * 0.08;
      return;
    }
    const w = walk.current;
    if (!w.ready) return;
    const k = keys.current;
    w.goalYaw += ((k.has("arrowleft") ? 1 : 0) - (k.has("arrowright") ? 1 : 0)) * dt * 1.6;
    const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const side = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    const push = wheel.current;
    wheel.current = 0;
    if (fwd || side || push) {
      const dir = new THREE.Vector3(Math.cos(w.goalYaw), 0, -Math.sin(w.goalYaw));
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      const step = dir.multiplyScalar(fwd * dt * 1.8 + push).add(right.multiplyScalar(side * dt * 1.4));
      const from: [number, number] = [w.goal.x, w.goal.z];
      const next: [number, number] = [w.goal.x + step.x, w.goal.z + step.z];
      // slide along walls: try the full step, then each axis on its own
      for (const cand of [next, [next[0], from[1]] as [number, number], [from[0], next[1]] as [number, number]]) {
        if (!blocked(plan, segments, from, cand)) {
          w.goal.set(cand[0], 1.6, cand[1]);
          break;
        }
      }
      const room = roomAt(plan, w.goal.x, w.goal.z);
      if (room && room !== useScene.getState().focusRoom) {
        walkedInto.current = room;
        useScene.getState().set({ focusRoom: room });
      }
    }
    const a = 1 - Math.exp(-dt * 6);
    w.pos.lerp(w.goal, a);
    w.yaw += (w.goalYaw - w.yaw) * a;
    camera.position.copy(w.pos);
    const look = new THREE.Vector3(Math.cos(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.sin(w.yaw) * Math.cos(w.pitch));
    camera.lookAt(w.pos.clone().add(look));
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.9}
      minDistance={0.3}
      maxDistance={60}
      maxPolarAngle={Math.PI * 0.495}
      dollyToCursor
    />
  );
}

function Ground() {
  const view = useScene((s) => s.view);
  const plan = useScene((s) => s.plan);
  const b = planBounds(plan);
  const thermal = view === "thermal";
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[b.cx, -0.01, b.cz]} receiveShadow>
        <circleGeometry args={[80, 64]} />
        <meshStandardMaterial color={thermal ? "#05010d" : "#0b120f"} roughness={1} />
      </mesh>
      <gridHelper args={[60, 60, "#16211c", "#101814"]} position={[b.cx, 0, b.cz]} visible={!thermal} />
    </group>
  );
}

function Lights() {
  const view = useScene((s) => s.view);
  const plan = useScene((s) => s.plan);
  const b = planBounds(plan);
  const moonTarget = useMemo(() => new THREE.Object3D(), []);
  moonTarget.position.set(b.cx, 0, b.cz);
  if (view === "thermal") return <ambientLight intensity={1} />;
  return (
    <>
      <hemisphereLight args={["#9fb4e0", "#2a2622", view === "exterior" ? 1.25 : 1.5]} />
      <ambientLight intensity={view === "inside" ? 0.6 : 0.35} />
      {/* soft key light from the viewer's side so the facades read clearly at night */}
      <directionalLight position={[b.cx + 12, 8, b.cz + 14]} intensity={0.9} color="#ffe2c4" />
      <primitive object={moonTarget} />
      <directionalLight
        position={[b.cx - 9, 14, b.cz + 10]}
        target={moonTarget}
        intensity={view === "exterior" ? 1.6 : 1.9}
        color="#c4d4ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
    </>
  );
}

function Atmosphere() {
  const view = useScene((s) => s.view);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const bg = new THREE.Color(view === "thermal" ? "#05020a" : "#060910");
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 22, 70);
  }, [view, scene]);
  return null;
}

/**
 * Infrared spot meter: casts a ray through the HUD crosshair a few times a second and
 * reports which room (or the outside) it lands on, so the readout follows the camera.
 */
function SpotMeter() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const active = useScene((s) => s.view === "thermal" || s.ir);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const last = useRef(0);
  useEffect(() => {
    if (!active) useScene.getState().set({ spot: null });
  }, [active]);
  useFrame(({ clock }) => {
    if (!active || clock.elapsedTime - last.current < 0.12) return;
    last.current = clock.elapsedTime;
    const { inset, plan, spot } = useScene.getState();
    // The crosshair sits in the middle of the space left of the side panel.
    const ndcX = inset > 0 ? -inset / size.width : 0;
    ray.setFromCamera(new THREE.Vector2(ndcX, 0), camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
    let room: string | null = null;
    if (hit) {
      const { x, z } = hit.point;
      const tol = 0.25; // walls sit on room edges; count a hit on either face
      const near = plan.rooms.filter((r) => x >= r.x - tol && x <= r.x + r.width + tol && z >= r.z - tol && z <= r.z + r.depth + tol);
      const cam = camera.position;
      near.sort((a, b) => Math.hypot(a.x + a.width / 2 - cam.x, a.z + a.depth / 2 - cam.z) - Math.hypot(b.x + b.width / 2 - cam.x, b.z + b.depth / 2 - cam.z));
      const inside = near.find((r) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth);
      room = (inside && near.length === 1 ? inside : near[0])?.room_id ?? null;
    }
    if (spot?.room !== room || spot === null) useScene.getState().set({ spot: { room } });
  });
  return null;
}

export function HouseCanvas({ className, effects = true, focusControl = false }: {
  className?: string;
  effects?: boolean;
  focusControl?: boolean;
}) {
  const [focusRequest, setFocusRequest] = useState(0);
  const compassNeedle = useRef<SVGGElement>(null);
  const inset = useScene((s) => s.inset);
  const focusHouse = () => {
    useScene.getState().set({ view: "open", focusRoom: null, walkTo: null, autoRotate: false, fanOn: false });
    // Trigger even when the view is already open: orbiting does not change scene state.
    setFocusRequest((request) => request + 1);
  };
  return (
    <div className={`${className ?? ""} isolate`}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [14, 7, 16], fov: 38, near: 0.05, far: 300 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}
      >
        <Suspense fallback={null}>
          <Atmosphere />
          <Lights />
          <Ground />
          <Stars radius={90} depth={40} count={1800} factor={3} fade speed={0.4} />
          <House />
          <Wind />
          <HeatFlux />
          <Airflow />
          <Rig focusRequest={focusRequest} />
          <SpotMeter />
          {focusControl && <CompassHeading needle={compassNeedle} />}
          {effects && (
            <EffectComposer multisampling={0}>
              <Bloom intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur />
              <Vignette eskil={false} offset={0.2} darkness={0.75} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
      {focusControl && (
        <div
          className="pointer-events-none absolute inset-x-4 top-[118px] z-20 flex items-center justify-end gap-2 min-[901px]:pr-[var(--scene-inset)]"
          style={{ "--scene-inset": `${Math.max(0, inset)}px` } as CSSProperties}
        >
          <CompassHud needle={compassNeedle} />
          <button
            type="button"
            onClick={focusHouse}
            aria-label="Focus house"
            title="Focus house — show the whole house"
            className="glass pointer-events-auto grid h-11 w-11 place-items-center rounded-full text-mute transition hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <LocateFixed size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      <RoomHopper />
      <ThermalHud />
    </div>
  );
}
