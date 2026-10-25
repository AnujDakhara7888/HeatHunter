// Typed API client. All types come from the generated OpenAPI schema
// (`npm run generate:api`); never hand-write parallel API interfaces.
import createClient from "openapi-fetch";
import type { components, paths } from "../api/schema";

export type Schemas = components["schemas"];
export type Diagnosis = Schemas["Diagnosis"];
export type NightObservations = Schemas["NightObservations"];
export type Series = Schemas["Series"];
export type HypothesisFit = Schemas["HypothesisFit"];
export type MoneyEstimate = Schemas["MoneyEstimate"];
export type MoneyResponse = Schemas["MoneyResponse"];
export type RepairResult = Schemas["RepairResult"];
export type GroundTruth = Schemas["GroundTruth"];
export type RealHouse = Schemas["RealHouse"];
export type EvaluationSummary = Schemas["EvaluationSummary"];
export type Assumption = Schemas["Assumption"];
export type Provenance = Schemas["Provenance"];
export type ScenarioCreateRequest = Schemas["ScenarioCreateRequest"];
export type FaultType = Schemas["FaultType"];
export type DiagnosisStatus = Schemas["DiagnosisStatus"];

const client = createClient<paths>({ baseUrl: "" });

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await promise;
  } catch {
    throw new ApiRequestError(0, "NETWORK", "The HeatHunter backend is unreachable. Is the API running?");
  }
  if (result.data !== undefined && result.response.ok) return result.data;
  const error = (result.error ?? {}) as { detail?: unknown; code?: string };
  const detail =
    typeof error.detail === "string"
      ? error.detail
      : Array.isArray(error.detail)
        ? error.detail.map((d: { msg?: string }) => d.msg).join("; ")
        : `Request failed (${result.response.status})`;
  throw new ApiRequestError(result.response.status, error.code ?? "HTTP_ERROR", detail);
}

const at = (id: string) => ({ params: { path: { id } } });

export const api = {
  health: () => unwrap(client.GET("/api/health")),
  createScenario: (body: ScenarioCreateRequest) => unwrap(client.POST("/api/scenarios", { body })),
  observations: (id: string) => unwrap(client.GET("/api/scenarios/{id}/observations", at(id))),
  diagnose: (id: string) => unwrap(client.POST("/api/scenarios/{id}/diagnose", { ...at(id), body: {} })),
  experiment: (id: string, diagnosisId: string) =>
    unwrap(
      client.POST("/api/scenarios/{id}/experiments", {
        ...at(id),
        body: { diagnosis_id: diagnosisId, experiment_type: "exhaust_fan_depressurization" },
      }),
    ),
  money: (id: string, body: Schemas["MoneyRequest"]) =>
    unwrap(client.POST("/api/scenarios/{id}/money", { ...at(id), body })),
  repair: (id: string, diagnosisId: string, effectiveness: number) =>
    unwrap(
      client.POST("/api/scenarios/{id}/repair", {
        ...at(id),
        body: { diagnosis_id: diagnosisId, effectiveness },
      }),
    ),
  reveal: (id: string) => unwrap(client.GET("/api/scenarios/{id}/reveal", at(id))),
  realHouse: () => unwrap(client.GET("/api/real/house")),
  evaluation: () => unwrap(client.GET("/api/evaluation/summary")),
  chat: (body: Schemas["ChatRequest"]) => unwrap(client.POST("/api/chat", { body })),
};

export const FLOOR_PLAN_URL = "/api/real/house/floor-plan";
