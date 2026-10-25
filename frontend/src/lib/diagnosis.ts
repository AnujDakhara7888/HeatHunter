import type { RoomStatus } from "../api/types";
import { CAUSE, type CauseKey } from "./rooms";

/** 0..1 visual intensity of a finding from the extra heat loss (%). */
export const strengthOf = (extraPercent: number | null | undefined) =>
  Math.min(1, Math.max(0.3, (extraPercent ?? 15) / 40));

export const causeLabel = (c: string) => CAUSE[c as CauseKey]?.label ?? c;

/** Plain-language room status, colour and icon (always shown with its label, never colour alone). */
export const ROOM_STATUS: Record<RoomStatus, { label: string; color: string; icon: string }> = {
  not_enough_data: { label: "Waiting for a night", color: "#626a7d", icon: "○" },
  healthy: { label: "Healthy", color: "#2fd18b", icon: "✓" },
  watching: { label: "Watching", color: "#ffb020", icon: "◔" },
  issue: { label: "Issue", color: "#ff6a3d", icon: "!" },
  issue_cause_unclear: { label: "Issue · cause unclear", color: "#ff6a3d", icon: "?" },
  verifying: { label: "Checking the fix", color: "#7aa8ff", icon: "↻" },
  resolved: { label: "Fixed", color: "#2fd18b", icon: "✓" },
  still_an_issue: { label: "Fix didn't work", color: "#ff3b5c", icon: "✕" },
};

export const FLAG_STATUSES: RoomStatus[] = ["issue", "issue_cause_unclear", "still_an_issue", "watching", "verifying"];
