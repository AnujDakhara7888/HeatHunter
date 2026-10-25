import { useMemo } from "react";
import * as THREE from "three";
import type { components } from "../api/schema";
import { useScene, type Insulation, type View } from "../store/scene";
import { WALL_H } from "./geometry";

/**
 * FLIR-style infrared material. Colour is an estimated SURFACE temperature (°C):
 * each surface sits between its room's measured air temperature and the outdoor
 * temperature, closer to the outside the worse it is insulated (ISO 6946 surface
 * resistances). Inside, glass reads colder than walls; outside, the reverse.
 * The engine's finding acts through the same physics: weak insulation raises the
 * flagged room's wall U-value; a draught chills (inside) or warms (outside) the
 * frames of its windows and doors.
 */

export const R_SI = 0.13; // m2.K/W, inside surface resistance
export const R_SE = 0.04; // m2.K/W, outside surface resistance
export const MAX_ROOMS = 16;
export const MAX_LEAKS = 8;

/** What a mesh is made of, which decides how its temperature is estimated. */
export const ENVELOPE = 0; // outside walls, roof, ceiling, floor, doors
export const GLASS = 1;
export const INTERIOR = 2; // partitions and furniture sit at room air temperature

export type ThermalUniforms = ReturnType<typeof createThermalUniforms>;

/** One uniform set shared by every thermal material, so a single update recolours the house. */
export function createThermalUniforms() {
  return {
    uRooms: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector4()) },
    uRoomCount: { value: 0 },
    uTin: { value: new Array<number>(MAX_ROOMS).fill(18) },
    uU: { value: new Array<number>(MAX_ROOMS).fill(0.7) },
    uWallU: { value: new Array<number>(MAX_ROOMS).fill(0.7) },
    uTavg: { value: 18 },
    uUavg: { value: 0.7 },
    uWinU: { value: 2.8 },
    uTout: { value: 5 },
    uLeaks: { value: Array.from({ length: MAX_LEAKS }, () => new THREE.Vector4()) },
    uLeakY: { value: Array.from({ length: MAX_LEAKS }, () => new THREE.Vector2()) },
    uLeakCount: { value: 0 },
    uLeakK: { value: 0 },
    uLeakT: { value: 18 },
    uRange: { value: new THREE.Vector2(0, 20) },
  };
}

export function createThermalMaterial(kind: number, uniforms: ThermalUniforms) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...uniforms, uKind: { value: kind } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormal;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vWorld=w.xyz; vNormal=normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      #define MAX_ROOMS ${MAX_ROOMS}
      #define MAX_LEAKS ${MAX_LEAKS}
      uniform vec4 uRooms[MAX_ROOMS]; uniform int uRoomCount;
      uniform float uTin[MAX_ROOMS]; uniform float uU[MAX_ROOMS]; uniform float uWallU[MAX_ROOMS];
      uniform float uTavg; uniform float uUavg; uniform float uWinU; uniform float uTout;
      uniform vec4 uLeaks[MAX_LEAKS]; uniform vec2 uLeakY[MAX_LEAKS]; uniform int uLeakCount;
      uniform float uLeakK; uniform float uLeakT;
      uniform vec2 uRange; uniform int uKind;
      varying vec3 vWorld; varying vec3 vNormal;
      // FLIR "rainbow HC" style: deep blue → blue → cyan → green → yellow → orange → red → pink-white
      vec3 flir(float v){ v=clamp(v,0.,1.);
        vec3 c[8];
        c[0]=vec3(.02,.02,.25); c[1]=vec3(.05,.15,.75); c[2]=vec3(.0,.55,.95); c[3]=vec3(.1,.75,.35);
        c[4]=vec3(.95,.9,.1); c[5]=vec3(1.,.55,.05); c[6]=vec3(.9,.1,.1); c[7]=vec3(1.,.75,.8);
        float x=v*7.; int i=int(floor(x)); float f=fract(x);
        vec3 a=c[0], b=c[1];
        for(int k=0;k<7;k++){ if(k==i){ a=c[k]; b=c[k+1]; } }
        if(i>=7) return c[7];
        return mix(a,b,smoothstep(0.,1.,f)); }
      float hash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
      float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        float n000=hash(i), n100=hash(i+vec3(1,0,0)), n010=hash(i+vec3(0,1,0)), n110=hash(i+vec3(1,1,0));
        float n001=hash(i+vec3(0,0,1)), n101=hash(i+vec3(1,0,1)), n011=hash(i+vec3(0,1,1)), n111=hash(i+vec3(1,1,1));
        return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z); }
      int roomAt(vec2 p){
        for(int i=0;i<MAX_ROOMS;i++){ if(i>=uRoomCount) break; vec4 r=uRooms[i];
          if(p.x>=r.x && p.x<=r.z && p.y>=r.y && p.y<=r.w) return i; }
        return -1; }
      float tinOf(int r){ for(int i=0;i<MAX_ROOMS;i++){ if(i==r) return uTin[i]; } return uTavg; }
      float uOf(int r){ for(int i=0;i<MAX_ROOMS;i++){ if(i==r) return uU[i]; } return uUavg; }
      float wallUOf(int r){ for(int i=0;i<MAX_ROOMS;i++){ if(i==r) return uWallU[i]; } return uUavg; }
      void main(){
        vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
        bool level = abs(n.y) > .5;
        // Which room does this face belong to, and does it face into it or out of the house?
        int r; bool inside;
        // floors face up from below; ceilings face down from wall height (a roof's underside is outside)
        if(level){ r = roomAt(vWorld.xz); inside = n.y > 0. ? vWorld.y < 1.2 : r >= 0 && vWorld.y < ${WALL_H + 0.05}; }
        else { int ahead = roomAt(vWorld.xz + n.xz*.12); inside = ahead >= 0;
               r = inside ? ahead : roomAt(vWorld.xz - n.xz*.12); }
        if(uKind == ${INTERIOR} && r < 0){ r = roomAt(vWorld.xz); inside = true; }
        float tin = tinOf(r);
        float dT = tin - uTout;
        float t;
        if(uKind == ${INTERIOR}) t = tin;
        else {
          float u = uKind == ${GLASS} ? uWinU : (level ? uOf(r) : wallUOf(r));
          // thermal bridges: wall-floor and wall-ceiling junctions lose more heat
          if(uKind == ${ENVELOPE} && !level) u *= 1. + .5*(smoothstep(.35,0.,vWorld.y) + smoothstep(2.05,2.4,vWorld.y));
          t = inside ? tin - u*${R_SI}*dT : uTout + u*${R_SE}*dT;
        }
        // Draught: air moving through the frames of the leaking room's openings.
        if(uLeakCount > 0 && uKind != ${INTERIOR}){
          float jet = 0.;
          for(int i=0;i<MAX_LEAKS;i++){ if(i>=uLeakCount) break;
            vec2 a = uLeaks[i].xy, ab = uLeaks[i].zw - a; float len = length(ab); vec2 dir = ab/len;
            vec2 rel = vWorld.xz - a;
            if(abs(dir.x*rel.y - dir.y*rel.x) > .25) continue; // only the wall the opening sits in
            vec2 q = vec2(dot(rel,dir), vWorld.y), lo = vec2(0., uLeakY[i].x), hi = vec2(len, uLeakY[i].y);
            float outside = length(max(max(lo-q, q-hi), 0.));
            float within = max(min(min(q.x-lo.x, hi.x-q.x), min(q.y-lo.y, hi.y-q.y)), 0.);
            float d = outside > 0. ? outside : within; // distance from the frame
            float span = step(lo.x,q.x)*step(q.x,hi.x);
            // cold air falls below the frame inside; warm air rises above it outside
            float trail = inside ? span*step(q.y,lo.y)*exp(-(lo.y-q.y)/.5) : span*step(hi.y,q.y)*exp(-(q.y-hi.y)/.5);
            jet = max(jet, max(exp(-d*d/.012), .6*trail));
          }
          t += (inside ? -1. : .5)*uLeakK*jet*(uLeakT - uTout);
        }
        t += .25*(noise(vWorld*1.6)-.5); // surface texture, about ±0.1 °C
        gl_FragColor = vec4(flir((t-uRange.x)/max(uRange.y-uRange.x,.1)),1.);
      }`,
  });
}

/** API insulation figures → scene, renaming rooms to plan ids where needed. */
export function toInsulation(api: components["schemas"]["SurfaceInsulation"], rename: Record<string, string> = {}): Insulation {
  const keyed = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [rename[k] ?? k, v]));
  return {
    envelope: keyed(api.envelope_u_w_per_m2k),
    heatLoss: keyed(api.room_heat_loss_w_per_k),
    fallback: api.default_envelope_u_w_per_m2k,
    window: api.window_u_w_per_m2k,
  };
}

/**
 * How far a draught's jet pulls the frame surface towards outdoor temperature (0..1):
 * grows with the engine's extra heat loss and with wind. An illustrative scale, not a fit.
 */
export function leakStrength(extra: number, wind: number | null) {
  const size = THREE.MathUtils.clamp(extra / 0.3, 0.2, 1);
  const breeze = 0.6 + 0.4 * Math.min(Math.max(wind ?? 0, 0) / 5, 1);
  return 0.45 * size * breeze;
}

/**
 * The colour scale for a whole night: the coldest and warmest surface it can show.
 * Inside, the coldest surface is glass (or a leaking frame); outside, the warmest is
 * glass or a leaking wall. Room air bounds come from `tempRange`.
 */
export function irRange(
  side: "inside" | "outside",
  air: [number, number],
  outdoor: [number, number],
  maxU: number,
  leak: number,
): [number, number] {
  const [airLo, airHi] = air;
  const [outLo, outHi] = outdoor;
  if (side === "inside") return [Math.min(airLo - maxU * R_SI * (airLo - outLo), airLo - leak * (airLo - outLo)), airHi];
  return [outLo - 0.3, Math.max(outHi + maxU * R_SE * (airHi - outLo), outHi + 0.5 * leak * (airHi - outLo)) + 0.3];
}

/** Views that look at inside faces (into the rooms) rather than at the outside of the house. */
export const looksInside = (view: View) => view === "inside" || view === "open" || view === "fan" || view === "top";

/** Until the API's insulation figures arrive (a moment after the page loads). */
export const UNTIL_LOADED: Insulation = { envelope: {}, heatLoss: {}, fallback: 0.7, window: 2.8 };

/** The night's fixed IR colour scale for the current viewpoint; shared by the 3D view and the HUD. */
export function useIrScale() {
  const view = useScene((s) => s.view);
  const air = useScene((s) => s.tempRange);
  const outdoorRange = useScene((s) => s.outdoorRange);
  const outdoor = useScene((s) => s.outdoor);
  const insulation = useScene((s) => s.insulation) ?? UNTIL_LOADED;
  const finding = useScene((s) => s.finding);
  const side = looksInside(view) ? ("inside" as const) : ("outside" as const);
  const out: [number, number] = outdoorRange ?? (outdoor != null ? [outdoor, outdoor] : [air[0] - 8, air[0] - 8]);
  const maxU = Math.max(insulation.window, ...Object.values(insulation.envelope));
  const leak = finding?.cause === "draft" && finding.extra ? leakStrength(finding.extra, 5) : 0;
  const range = useMemo(() => irRange(side, air, out, maxU, leak), [side, air[0], air[1], out[0], out[1], maxU, leak]); // eslint-disable-line react-hooks/exhaustive-deps
  return { side, range };
}
