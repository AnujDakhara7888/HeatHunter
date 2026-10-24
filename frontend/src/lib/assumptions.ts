import type { Assumption } from "./api";

export function findAssumption(list: Assumption[] | undefined, name: string): Assumption | undefined {
  return list?.find((a) => a.name === name);
}

export function numericAssumption(list: Assumption[] | undefined, name: string): number | null {
  const value = findAssumption(list, name)?.value;
  return typeof value === "number" ? value : null;
}

/** Repair-cost assumptions are flagged in the source notes when unverified. */
export function isUnverified(a: Assumption): boolean {
  const text = `${a.source?.notes ?? ""} ${a.source?.dataset ?? ""}`.toLowerCase();
  return text.includes("unverified") || text.includes("illustrative");
}
