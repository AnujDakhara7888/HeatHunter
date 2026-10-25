import type { Diagnosis, FitCurve, RoomInsight } from "../api/types";
import { CAUSE, type CauseKey } from "./rooms";

export const strengthOf = (multiplier: number) => Math.min(1, Math.max(0.25, (multiplier - 1) / 1.5));

export function assumption(d: Diagnosis | null | undefined, name: string): number | null {
  const a = d?.assumptions.find((x) => x.name === name);
  return typeof a?.value === "number" ? a.value : null;
}

export function bicGap(d: Diagnosis | null | undefined) {
  if (!d || d.ranked_causes.length < 2) return null;
  return d.ranked_causes[1].bic - d.ranked_causes[0].bic;
}

export const causeLabel = (c: string) => CAUSE[c as CauseKey]?.label ?? c;

export const STATUS_COPY: Record<string, { label: string; color: string; line: string }> = {
  confident: { label: "Confident", color: "#2fd18b", line: "One explanation clearly wins." },
  ambiguous: { label: "Ambiguous", color: "#ffb020", line: "Two explanations fit almost equally well." },
  unexplained: { label: "Unexplained", color: "#ff6a3d", line: "No explanation fits well enough to act on." },
  no_fault: { label: "No fault found", color: "#3aa0ff", line: "Every room cools the way the model expects." },
};

export function fitsFor(insight: RoomInsight | undefined) {
  const by = Object.fromEntries((insight?.fits ?? []).map((f) => [f.fault_type, f])) as Record<string, FitCurve>;
  return by;
}
