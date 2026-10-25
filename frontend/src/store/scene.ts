import { create } from "zustand";
import type { HomePlan } from "../api/types";
import { HH09_PLAN } from "../lib/plan";

export type View = "exterior" | "thermal" | "open" | "inside" | "fan" | "top";

export type Finding = {
  room: string; // plan room id
  cause: "draft" | "envelope_conduction" | null;
  strength: number; // 0..1 visual intensity, from the fitted multiplier
};

export type SceneState = {
  plan: HomePlan;
  view: View;
  temps: Record<string, number | null>;
  tempRange: [number, number];
  outdoor: number | null;
  wind: number | null;
  finding: Finding | null;
  focusRoom: string | null;
  fanOn: boolean;
  labels: boolean;
  autoRotate: boolean;
  names: Record<string, string>;
  inset: number;
  rates: Record<string, number | null>;
  set: (patch: Partial<SceneState>) => void;
};

export const useScene = create<SceneState>((set) => ({
  plan: HH09_PLAN,
  view: "exterior",
  temps: {},
  tempRange: [12, 21],
  outdoor: null,
  wind: null,
  finding: null,
  focusRoom: null,
  fanOn: false,
  labels: true,
  autoRotate: false,
  names: {},
  inset: 0,
  rates: {},
  set: (patch) => set(patch),
}));
