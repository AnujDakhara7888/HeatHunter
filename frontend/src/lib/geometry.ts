// Simplified HH09 plan geometry shared by the 2D schematic and the 3D model.
// Rectangle sizes use the room dimensions printed on the published SMETER HH09
// floor plan (page 9); positions are approximate. Units: centimetres, plan
// x to the right, plan y downward. This is not verified as-built geometry.
import type { TwinRoomId } from "./rooms";

export type Rect = { x: number; y: number; w: number; h: number };

export const PLAN_ROOMS: Record<TwinRoomId, Rect> = {
  bedroom_1: { x: 0, y: 0, w: 311, h: 380 },
  kitchen: { x: 323, y: 0, w: 314, h: 182 },
  living_room: { x: 323, y: 194, w: 315, h: 436 },
  bedroom_2: { x: 197, y: 392, w: 114, h: 239 },
};

export const PLAN_UNMODELED: { label: string; rect: Rect }[] = [
  { label: "Closet", rect: { x: 0, y: 392, w: 92, h: 87 } },
  { label: "Boiler", rect: { x: 100, y: 392, w: 87, h: 75 } },
  { label: "Bathroom", rect: { x: 0, y: 491, w: 180, h: 273 } },
];

/** Documented window widths (SMETER_P2_WindowArea_Orientation); positions schematic. */
export const PLAN_WINDOWS = [
  { x1: 47, y1: 0, x2: 283, y2: 0 },
  { x1: 504, y1: 0, x2: 625, y2: 0 },
  { x1: 363, y1: 630, x2: 599, y2: 630 },
];

export const PLAN_EXTENT = { w: 638, h: 764 };

/** Assumed 2.4 m ceiling height (HeatHunter assumption, as in the twin inputs). */
export const CEILING_M = 2.4;
