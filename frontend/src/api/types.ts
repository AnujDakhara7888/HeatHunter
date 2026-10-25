import type { components } from "./schema";

type S = components["schemas"];
export type Series = S["Series"];
export type RealHouse = S["RealHouse"];
export type HomePlan = S["HomePlan"];
export type PlanRoom = S["PlanRoom"];
export type PlanOpening = S["PlanOpening"];
export type WeatherLookup = S["WeatherLookup"];
export type ChatReply = S["ChatReply"];
export type ChatAction = S["ChatAction"];
export type AssistantScreen = S["AssistantScreen"];
export type FloorPlanDraft = S["FloorPlanDraft"];

// API v2: homes monitored night after night
export type HomeSummary = S["HomeSummary"];
export type HomeHealth = S["HomeHealth"];
export type RoomHealthView = S["RoomHealthView"];
export type RoomStatus = S["RoomStatus"];
export type HomeReadings = S["HomeReadings"];
export type NightInfo = S["NightInfo"];
export type RoomReport = S["RoomReport"];
export type RoomTechnical = S["RoomTechnical"];
export type NightEvidence = S["NightEvidence"];
export type DemoHomeCreate = S["DemoHomeCreate"];
export type FixAction = S["FixAction"];
export type HomeCreate = S["HomeCreate"];
export type DemoWeek = S["DemoWeek"];
export type HouseShape = S["HouseShape"];
export type HomeHistory = S["HomeHistory"];
export type RoomHistory = S["RoomHistory"];
export type RoomNightSnapshot = S["RoomNightSnapshot"];
export type HypothesisSummary = S["HypothesisSummary"];
