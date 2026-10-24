import { useEffect, useMemo, useRef, useState } from "react";
import type { NightObservations } from "../../lib/api";
import { TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";
import type { ChartSeries } from "../../components/TelemetryChart";
import type { RoomReading } from "./TwinHouse";
import type { Investigation } from "./useInvestigation";

export interface Dataset {
  key: string;
  label: string;
  night: NightObservations;
  repaired: boolean;
}

export function valueAt(values: (number | null)[], index: number): number | null {
  for (let i = Math.min(index, values.length - 1); i >= 0; i--) if (values[i] != null) return values[i];
  return null;
}
export function firstValue(values: (number | null)[]): number | null {
  return values.find((v) => v != null) ?? null;
}
export function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Observation sets, night playback and per-room readings shared by Simple and Expert views. */
export function useTwinState(state: Investigation) {
  const [selected, setSelected] = useState<TwinRoomId | null>(null);
  const [datasetKey, setDatasetKey] = useState("n0");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const first = state.diagnoses[0];
  const latest = state.diagnoses[state.diagnoses.length - 1];
  const flagged = latest?.status === "ambiguous" || latest?.status === "confident" ? latest.flagged_room_id : null;

  const datasets: Dataset[] = useMemo(() => {
    const list: Dataset[] = state.nights.map((night, i) => ({
      key: `n${i}`,
      label: night.kind === "fan_test" ? "Fan-test night" : "Passive night",
      night,
      repaired: false,
    }));
    state.repair?.repaired_observations.forEach((night, i) =>
      list.push({ key: `r${i}`, label: `Repaired · ${night.kind === "fan_test" ? "fan test" : "passive"}`, night, repaired: true }),
    );
    return list;
  }, [state.nights, state.repair]);

  // Follow the newest evidence: fan night after the experiment, re-measurement after repair.
  useEffect(
    () => setDatasetKey(datasets.length ? datasets[datasets.length - (state.repair ? state.repair.repaired_observations.length : 1)].key : "n0"),
    [datasets, state.repair],
  );
  useEffect(() => {
    if (flagged) setSelected(flagged as TwinRoomId);
  }, [flagged]);
  useEffect(() => {
    if (!state.scenarioId) setSelected(null);
  }, [state.scenarioId]);

  const dataset = datasets.find((d) => d.key === datasetKey) ?? datasets[0];
  // The anomaly marker belongs to the pre-repair diagnosis; don't show it on re-measured nights.
  const shownFlag = dataset?.repaired ? null : flagged;
  const night = dataset?.night;
  const length = night?.weather.outdoor_temperature.timestamps.length ?? 0;

  useEffect(() => {
    setIndex(Math.max(0, length - 1));
    setPlaying(false);
  }, [datasetKey, length]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => {
        if (i >= length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 70);
    return () => window.clearInterval(timer.current);
  }, [playing, length]);

  const { readings, range } = useMemo(() => {
    const readings: Partial<Record<TwinRoomId, RoomReading>> = {};
    if (night) {
      for (const id of TWIN_ORDER) {
        const values = night.room_temperature_series[id]?.values ?? [];
        const temp = valueAt(values, index);
        const start = firstValue(values);
        readings[id] = { temp, drop: temp != null && start != null ? start - temp : null };
      }
    }
    // Colour compares rooms at this instant; a minimum span keeps sensor noise from looking dramatic.
    const temps = Object.values(readings).flatMap((r) => (r?.temp != null ? [r.temp] : []));
    const mid = temps.length ? (Math.min(...temps) + Math.max(...temps)) / 2 : 0;
    const half = Math.max(0.75, temps.length ? (Math.max(...temps) - Math.min(...temps)) / 2 : 0);
    return { readings, range: [mid - half, mid + half] as [number, number] };
  }, [night, index]);

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (!night) return [];
    const rooms: ChartSeries[] = TWIN_ORDER.filter((id) => night.room_temperature_series[id]).map((id) => ({
      key: id,
      label: TWIN_ROOMS[id].name,
      color: TWIN_ROOMS[id].color,
      series: night.room_temperature_series[id],
      emphasis: selected ? (selected === id ? "focus" : "dim") : "normal",
      endLabel: selected === id,
    }));
    return [
      ...rooms,
      { key: "outdoor", label: "Outdoor", color: "var(--color-outdoor)", dashed: true, series: night.weather.outdoor_temperature, endLabel: true },
    ];
  }, [night, selected]);

  const protocol = night?.protocol;
  const fan = protocol?.fan_on && protocol.fan_start && protocol.fan_end ? { start: protocol.fan_start, end: protocol.fan_end } : null;
  const cursorIso = night?.weather.outdoor_temperature.timestamps[index] ?? null;
  const fanOnNow = !!(fan && cursorIso && cursorIso >= fan.start && cursorIso < fan.end);

  return {
    selected,
    setSelected,
    datasets,
    datasetKey,
    setDatasetKey,
    dataset,
    night,
    length,
    index,
    setIndex,
    playing,
    setPlaying,
    readings,
    range,
    chartSeries,
    protocol,
    fan,
    cursorIso,
    fanOnNow,
    first,
    latest,
    flagged: shownFlag,
  };
}

export type TwinState = ReturnType<typeof useTwinState>;
