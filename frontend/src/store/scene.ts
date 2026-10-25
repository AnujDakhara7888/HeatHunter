import { create } from "zustand";
import type { HomePlan } from "../api/types";
import { HH09_PLAN } from "../lib/plan";

export type View = "exterior" | "thermal" | "open" | "inside" | "fan" | "top";

export type Finding = {
  room: string; // plan room id
  cause: "draft" | "envelope_conduction" | null;
  strength: number; // 0..1 visual intensity, from the fitted multiplier
  /** The engine's extra heat loss as a fraction of the room's nominal loss (0.15 = 15%), when known. */
  extra?: number | null;
};

/** The engine's insulation figures, keyed by plan room id; they turn air temperatures into surface temperatures. */
export type Insulation = {
  envelope: Record<string, number>; // effective U-value of walls, roof and floor, W/(m2.K)
  heatLoss: Record<string, number>; // nominal seasonal heat loss, W/K (what `Finding.extra` is a fraction of)
  fallback: number; // U-value for rooms with no figure of their own
  window: number; // window U-value, W/(m2.K)
};

export type SceneState = {
  plan: HomePlan;
  view: View;
  temps: Record<string, number | null>;
  tempRange: [number, number];
  outdoor: number | null;
  /** Coldest and warmest outdoor temperature of the night on screen. */
  outdoorRange: [number, number] | null;
  insulation: Insulation | null;
  wind: number | null;
  finding: Finding | null;
  focusRoom: string | null;
  fanOn: boolean;
  labels: boolean;
  autoRotate: boolean;
  names: Record<string, string>;
  inset: number;
  /** Infrared camera overlay, independent of where the camera is. */
  ir: boolean;
  /** Direction the wind blows FROM (degrees from north), when measured. */
  windFrom: number | null;
  /** Compass bearing the plan's +z axis faces, when documented. */
  zBearing: number | null;
  /** Walk-in: a floor point the user double-clicked to walk to. */
  walkTo: [number, number] | null;
  rates: Record<string, number | null>;
  /** Infrared spot meter: what is under the crosshair (a room, or outside the house). */
  spot: { room: string | null } | null;
  set: (patch: Partial<SceneState>) => void;
};

export const useScene = create<SceneState>((set) => ({
  plan: HH09_PLAN,
  view: "exterior",
  temps: {},
  tempRange: [12, 21],
  outdoor: null,
  outdoorRange: null,
  insulation: null,
  wind: null,
  finding: null,
  focusRoom: null,
  fanOn: false,
  labels: true,
  autoRotate: false,
  names: {},
  inset: 0,
  ir: false,
  windFrom: null,
  zBearing: null,
  walkTo: null,
  rates: {},
  spot: null,
  set: (patch) => set(patch),
}));
