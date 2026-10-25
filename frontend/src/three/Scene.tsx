import { CameraControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { planBounds, roomCenter } from "../lib/plan";
import { useScene, type View } from "../store/scene";
import { Airflow, HeatFlux, Wind } from "./Effects";
import { outwardNormal, wallPieces } from "./geometry";
import { House } from "./House";

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
      const seg = wallPieces(plan).segments.find((s) => s.exterior && s.rooms.includes(r.room_id));
      if (seg) {
        const n = outwardNormal(seg, plan);
        const wx = (seg.x0 + seg.x1) / 2;
        const wz = (seg.z0 + seg.z1) / 2;
        // stand back from the wall, inside the room (or in the neighbouring room for tiny ones)
        const back = Math.max(Math.abs(n[0]) ? r.width : r.depth, 2.2) * 0.85;
        return { pos: [wx - n[0] * back + n[1] * 0.4, 1.55, wz - n[1] * back + n[0] * 0.4], target: [wx, 1.15, wz] };
      }
      return { pos: [rx - 1.2, 1.55, rz - 1.2], target: [rx, 1.2, rz] };
    }
    if ((view === "open" || view === "fan") && focus && room) {
      const [rx, rz] = roomCenter(room);
      return { pos: [rx + 6, 11, rz + 8], target: [rx, 0, rz] };
    }
    return shots[view];
  }, [plan, view, focus, finding]);
}

function Rig() {
  const ref = useRef<CameraControls>(null);
  const shot = useShot();
  const view = useScene((s) => s.view);
  const autoRotate = useScene((s) => s.autoRotate);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const inset = useScene((s) => s.inset);
  useEffect(() => {
    // Keep the house centred in the space left of a side panel.
    if (inset !== 0 && size.width > 900) camera.setViewOffset(size.width, size.height, inset / 2, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [inset, size, camera]);
  useEffect(() => {
    camera.fov = view === "inside" ? 68 : 38;
    camera.updateProjectionMatrix();
    // Narrow canvases need the camera further back to fit the house.
    const aspect = size.width / size.height;
    const k = view === "inside" ? 1 : Math.min(1.7, Math.max(1, 1.5 / aspect));
    const [px, py, pz] = shot.pos;
    const [tx, ty, tz] = shot.target;
    ref.current?.setLookAt(tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k, tx, ty, tz, true);
  }, [shot, view, camera, size.width, size.height]);
  useFrame((_, dt) => {
    if (autoRotate && ref.current && !ref.current.active) ref.current.azimuthAngle += dt * 0.08;
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
      <hemisphereLight args={["#5d76b0", "#0a0d10", view === "exterior" ? 0.55 : 1.0]} />
      <primitive object={moonTarget} />
      <directionalLight
        position={[b.cx - 9, 14, b.cz + 10]}
        target={moonTarget}
        intensity={view === "exterior" ? 1.0 : 1.5}
        color="#a9c1ff"
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

export function HouseCanvas({ className, effects = true }: { className?: string; effects?: boolean }) {
  return (
    <div className={className}>
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
          <Rig />
          {effects && (
            <EffectComposer multisampling={0}>
              <Bloom intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.2} mipmapBlur />
              <Vignette eskil={false} offset={0.2} darkness={0.75} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}
