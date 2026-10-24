// Presentation mapping for HH09 room identities. Simulator slot IDs and the
// HH09 display names follow data/processed/hh09_twin_inputs.json
// (room_mapping_policy: the bedroom_2 slot is the HH09 Hall).

export type TwinRoomId = "living_room" | "kitchen" | "bedroom_1" | "bedroom_2";

export interface RoomMeta {
  name: string;
  short: string;
  color: string;
  /** Source room in the real SMETER HH09 file. */
  sourceRoom: string;
}

export const TWIN_ROOMS: Record<TwinRoomId, RoomMeta> = {
  living_room: { name: "Living Room", short: "LIV", color: "var(--color-room-living)", sourceRoom: "living_room" },
  kitchen: { name: "Kitchen", short: "KIT", color: "var(--color-room-kitchen)", sourceRoom: "kitchen" },
  bedroom_1: { name: "Bedroom", short: "BED", color: "var(--color-room-bedroom)", sourceRoom: "bedroom" },
  bedroom_2: { name: "Hall", short: "HAL", color: "var(--color-room-hall)", sourceRoom: "hall" },
};

export const TWIN_ORDER: TwinRoomId[] = ["living_room", "kitchen", "bedroom_1", "bedroom_2"];

/** Rooms in the real HH09 measurements (five sensors). */
export const REAL_ROOMS: Record<string, { name: string; color: string; twinSlot: TwinRoomId | null }> = {
  living_room: { name: "Living Room", color: "var(--color-room-living)", twinSlot: "living_room" },
  kitchen: { name: "Kitchen", color: "var(--color-room-kitchen)", twinSlot: "kitchen" },
  bedroom: { name: "Bedroom", color: "var(--color-room-bedroom)", twinSlot: "bedroom_1" },
  hall: { name: "Hall", color: "var(--color-room-hall)", twinSlot: "bedroom_2" },
  bathroom: { name: "Bathroom", color: "var(--color-room-bathroom)", twinSlot: null },
};

export function roomName(id: string | null | undefined): string {
  if (!id) return "—";
  return (TWIN_ROOMS as Record<string, RoomMeta>)[id]?.name ?? REAL_ROOMS[id]?.name ?? id;
}

export const CAUSE_LABEL: Record<string, string> = {
  normal: "Normal behaviour",
  draft: "Air leak (draft)",
  envelope_conduction: "Envelope conduction",
  none: "No fault",
};

export const REPAIR_LABEL: Record<string, string> = {
  draft: "Seal leaks",
  envelope_conduction: "Add insulation",
  none: "No repair",
};
