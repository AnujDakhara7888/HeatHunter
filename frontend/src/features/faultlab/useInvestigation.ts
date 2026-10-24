import { useCallback, useRef, useState } from "react";
import {
  api,
  ApiRequestError,
  type Diagnosis,
  type GroundTruth,
  type MoneyResponse,
  type NightObservations,
  type RepairResult,
  type ScenarioCreateRequest,
} from "../../lib/api";
import { CAUSE_LABEL, roomName } from "../../lib/rooms";
import { fmt, nowUtc, shortId } from "../../lib/format";

export type Mode = ScenarioCreateRequest["mode"];
export type Busy = null | "create" | "diagnose" | "experiment" | "repair" | "reveal" | "money";

export interface LogEntry {
  id: number;
  time: string;
  action: string;
  detail: string;
  tone: "info" | "ok" | "warn" | "crit" | "muted";
  ms?: number;
}

export interface Investigation {
  scenarioId: string | null;
  mode: Mode | null;
  nights: NightObservations[];
  diagnoses: Diagnosis[];
  experimentRun: boolean;
  money: MoneyResponse | null;
  repair: RepairResult | null;
  truth: GroundTruth | null;
  busy: Busy;
  error: string | null;
  log: LogEntry[];
}

const EMPTY: Investigation = {
  scenarioId: null,
  mode: null,
  nights: [],
  diagnoses: [],
  experimentRun: false,
  money: null,
  repair: null,
  truth: null,
  busy: null,
  error: null,
  log: [],
};

function summarize(d: Diagnosis): string {
  const lead = d.ranked_causes[0];
  const gap = d.ranked_causes.length > 1 ? d.ranked_causes[1].bic - d.ranked_causes[0].bic : null;
  const parts = [d.status.toUpperCase()];
  if (d.flagged_room_id) parts.push(roomName(d.flagged_room_id));
  if (lead) parts.push(`lead ${CAUSE_LABEL[lead.fault_type]}`);
  if (gap !== null) parts.push(`gap ${fmt(gap, 1)} BIC`);
  return parts.join(" · ");
}

const statusTone = (d: Diagnosis): LogEntry["tone"] =>
  d.status === "confident" ? "crit" : d.status === "ambiguous" ? "warn" : d.status === "no_fault" ? "ok" : "info";

export function useInvestigation() {
  const [state, setState] = useState<Investigation>(EMPTY);
  const seq = useRef(0);
  const generation = useRef(0);
  const scenarioRef = useRef<string | null>(null);

  const log = useCallback((entry: Omit<LogEntry, "id" | "time">) => {
    setState((s) => ({ ...s, log: [{ ...entry, id: ++seq.current, time: nowUtc() }, ...s.log].slice(0, 60) }));
  }, []);

  /** Runs one API action; stale results from a reset scenario are dropped. */
  const run = useCallback(
    async <T,>(busy: Exclude<Busy, null>, label: string, fn: () => Promise<T>): Promise<T | null> => {
      const gen = generation.current;
      setState((s) => ({ ...s, busy, error: null }));
      const started = performance.now();
      try {
        const result = await fn();
        if (gen !== generation.current) return null;
        setState((s) => ({ ...s, busy: null }));
        return Object.assign(result as object, { __ms: Math.round(performance.now() - started) }) as T;
      } catch (err) {
        if (gen !== generation.current) return null;
        const message = err instanceof ApiRequestError ? `${err.message} [${err.code}]` : String(err);
        setState((s) => ({ ...s, busy: null, error: message }));
        log({ action: label, detail: message, tone: "crit", ms: Math.round(performance.now() - started) });
        return null;
      }
    },
    [log],
  );

  const ms = (value: unknown) => (value as { __ms?: number }).__ms;

  const start = useCallback(
    async (request: ScenarioCreateRequest) => {
      generation.current += 1;
      setState({ ...EMPTY, log: [] });
      const created = await run("create", "CREATE", () => api.createScenario(request));
      if (!created) return;
      scenarioRef.current = created.scenario_id;
      log({
        action: "CREATE",
        detail: `${request.mode.toUpperCase()} scenario ${shortId(created.scenario_id)} · hidden fault sealed`,
        tone: "info",
        ms: ms(created),
      });
      const observed = await run("create", "OBSERVE", () => api.observations(created.scenario_id));
      if (!observed) return;
      const night = observed.nights[0];
      setState((s) => ({ ...s, scenarioId: created.scenario_id, mode: request.mode, nights: observed.nights }));
      log({
        action: "OBSERVE",
        detail: `${observed.nights.length} night · ${Object.keys(night.room_temperature_series).length} rooms · ${night.weather.night_id}`,
        tone: "muted",
        ms: ms(observed),
      });
    },
    [log, run],
  );

  const diagnose = useCallback(async () => {
    const id = scenarioRef.current;
    if (!id) return;
    const result = await run("diagnose", "DIAGNOSE", () => api.diagnose(id));
    if (!result) return;
    setState((s) => ({ ...s, diagnoses: [result] }));
    log({ action: "DIAGNOSE", detail: summarize(result), tone: statusTone(result), ms: ms(result) });
    const decision = result.test_decision;
    if (decision?.separation_score != null) {
      log({
        action: "TEST-EVAL",
        detail: `E1 exhaust fan · separation ${fmt(decision.separation_score, 2)}σ · ${decision.recommended ? "RECOMMENDED" : "not informative"}`,
        tone: decision.recommended ? "info" : "muted",
      });
    }
  }, [log, run]);

  const runExperiment = useCallback(
    async (diagnosisId: string) => {
      const id = scenarioRef.current;
      if (!id) return;
      const result = await run("experiment", "EXPERIMENT", () => api.experiment(id, diagnosisId));
      if (!result) return;
      setState((s) => ({
        ...s,
        experimentRun: true,
        nights: [...s.nights, result.observations],
        diagnoses: [...s.diagnoses, result.updated_diagnosis],
      }));
      log({
        action: "EXPERIMENT",
        detail: `Fan test recorded · ${result.observations.night_id} · ${result.observations.protocol.fan_airflow_m3_per_h?.toFixed(0)} m³/h`,
        tone: "info",
        ms: ms(result),
      });
      log({ action: "REFIT", detail: summarize(result.updated_diagnosis), tone: statusTone(result.updated_diagnosis) });
    },
    [log, run],
  );

  const reprice = useCallback(
    async (diagnosisId: string, gasPrice: number | null, repairCost: number | null) => {
      const id = scenarioRef.current;
      if (!id) return;
      const result = await run("money", "MONEY", () =>
        api.money(id, {
          diagnosis_id: diagnosisId,
          gas_price_pence_per_kwh: gasPrice,
          repair_cost_gbp: repairCost,
        }),
      );
      if (!result) return;
      setState((s) => ({ ...s, money: result }));
    },
    [run],
  );

  const repair = useCallback(
    async (diagnosisId: string, effectiveness: number) => {
      const id = scenarioRef.current;
      if (!id) return;
      const result = await run("repair", "REPAIR", () => api.repair(id, diagnosisId, effectiveness));
      if (!result) return;
      setState((s) => ({ ...s, repair: result }));
      log({
        action: "REPAIR",
        detail: `${result.repair_type === "draft" ? "Seal leaks" : "Add insulation"} @ ${Math.round(result.effectiveness * 100)}% · re-measured`,
        tone: "ok",
        ms: ms(result),
      });
    },
    [log, run],
  );

  const reveal = useCallback(async () => {
    const id = scenarioRef.current;
    if (!id) return;
    const result = await run("reveal", "REVEAL", () => api.reveal(id));
    if (!result) return;
    setState((s) => ({ ...s, truth: result }));
    log({
      action: "REVEAL",
      detail: `Truth: ${CAUSE_LABEL[result.fault_type]}${result.actual_room_id ? ` · ${roomName(result.actual_room_id)}` : ""} · ${result.diagnosis_matched ? "MATCHED" : "NOT MATCHED"}`,
      tone: result.diagnosis_matched ? "ok" : "warn",
      ms: ms(result),
    });
  }, [log, run]);

  const reset = useCallback(() => {
    generation.current += 1;
    scenarioRef.current = null;
    setState(EMPTY);
  }, []);

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { state, start, diagnose, runExperiment, reprice, repair, reveal, reset, dismissError };
}
