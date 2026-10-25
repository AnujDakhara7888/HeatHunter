import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Vector3 } from "three";
import { useScene } from "../store/scene";
import { bearingToPlan } from "./Effects";

type Props = { needle: RefObject<SVGGElement | null> };

/** Update the flat compass from camera yaw without rerendering the page each frame. */
export function CompassHeading({ needle }: Props) {
  const zBearing = useScene((s) => s.zBearing);
  const right = useMemo(() => new Vector3(), []);
  const previous = useRef(Number.NaN);
  useFrame(({ camera }) => {
    if (!needle.current || zBearing == null) return;
    const [nx, nz] = bearingToPlan(0, zBearing);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const x = nx * right.x + nz * right.z;
    const y = nx * right.z - nz * right.x;
    const angle = Math.atan2(x, y) * 180 / Math.PI;
    if (!Number.isFinite(previous.current) || Math.abs(angle - previous.current) > 0.1) {
      needle.current.setAttribute("transform", `rotate(${angle} 22 22)`);
      previous.current = angle;
    }
  });
  return null;
}

export function CompassHud({ needle }: Props) {
  const zBearing = useScene((s) => s.zBearing);
  if (zBearing == null) return null;
  return (
    <div className="glass pointer-events-auto grid h-[52px] w-[52px] place-items-center rounded-full text-ink" title="North / South · follows your view">
      <svg viewBox="0 0 44 44" width="52" height="52" role="img" aria-label="Compass showing north and south">
        <g ref={needle}>
          <text x="22" y="11" textAnchor="middle" fill="currentColor" className="font-mono" fontSize="9" fontWeight="600">N</text>
          <path d="M22 15 17 27 22 24 27 27Z" fill="currentColor" />
          <path d="M22 32 19 26 22 27 25 26Z" fill="currentColor" opacity="0.25" />
          <text x="22" y="40" textAnchor="middle" fill="currentColor" className="font-mono" fontSize="9" fontWeight="600" opacity="0.7">S</text>
        </g>
      </svg>
    </div>
  );
}
