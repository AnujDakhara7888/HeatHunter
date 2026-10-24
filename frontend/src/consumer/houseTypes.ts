// Shared by the page and the lazy-loaded 3D house without pulling three.js into the main bundle.
export type Phase = "day" | "heating" | "night";
export type Problem = "draft" | "envelope_conduction" | "unsure" | null;
export type CameraView = "outside" | "inside";
export const THERMAL_STOPS = ["#2a3cff", "#1fa6ff", "#2fe0c0", "#ffe14d", "#ff8a2a", "#ff3b2f"];
export const THERMAL_CSS = `linear-gradient(90deg,${THERMAL_STOPS.join(",")})`;
