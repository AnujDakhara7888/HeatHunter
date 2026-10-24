import { ChevronRight, Pause, Play, Radar, SkipBack } from "lucide-react";
import { useEffect, useState } from "react";
import { GUIDED_FULL_ID, GUIDED_UNSURE_ID } from "../../lib/demo";
import { fmt, shortId, utcDate, utcTime } from "../../lib/format";
import { roomName, TWIN_ORDER, TWIN_ROOMS } from "../../lib/rooms";
import { SeriesLegend, TelemetryChart, WindChart } from "../../components/TelemetryChart";
import { ErrorNote, Notice, Panel, ProvenanceTag, Spinner } from "../../components/ui";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { MoneyPanel } from "./MoneyPanel";
import { RepairPanel } from "./RepairPanel";
import { RevealPanel } from "./RevealPanel";
import { ScenarioControls } from "./ScenarioControls";
import { TestPanel } from "./TestPanel";
import { TwinView } from "./TwinView";
import { useInvestigation, type InvestigationApi } from "./useInvestigation";
import { mean as meanOf, useTwinState, type TwinState } from "./useTwinState";
import { SimpleLab } from "./SimpleLab";
import { deriveSteps, EventLog, WorkflowRail } from "./Workflow";

const mean = meanOf;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });

export function ExpertLab({ inv, twin }: { inv: InvestigationApi; twin: TwinState }) {
  const { state, start, diagnose, runExperiment, reprice, repair, reveal, reset, dismissError } = inv;
  const { selected, setSelected, datasets, datasetKey, setDatasetKey, dataset, night, length, index, setIndex, playing, setPlaying } = twin;
  const { readings, range, chartSeries, protocol, fan, cursorIso, fanOnNow, first, latest, flagged } = twin;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const steps = deriveSteps(state);
  const busy = state.busy;

  // Next-step command bar.
  let next: { text: string; action?: { label: string; run: () => void } } = {
    text: "Start an investigation. The guided demo walks through every step; Judge mode lets you plant a hidden fault.",
    action: { label: "Start guided demo", run: () => start({ mode: "guided", guided_scenario_id: GUIDED_FULL_ID }) },
  };
  if (state.nights.length && !first) next = { text: "Evidence collected: one heating-off night of simulated room temperatures. Analyze it.", action: { label: "Analyze house", run: diagnose } };
  else if (first && first.test_decision?.recommended && !state.experimentRun)
    next = { text: "The leading causes can't be separated yet, and HeatHunter predicts the fan test can tell them apart.", action: { label: "Run recommended test", run: () => runExperiment(first.diagnosis_id) } };
  else if (latest?.status === "confident" && !state.repair)
    next = { text: "Cause identified. Review the modeled cost, then apply the diagnosed repair and re-measure.", action: { label: "Go to repair", run: () => scrollTo("panel-repair") } };
  else if (first && !state.truth)
    next = { text: latest?.status === "confident" ? "Repair verified in simulation. Reveal the hidden fault to see whether HeatHunter was right." : "The investigation has gone as far as the evidence allows. Reveal the hidden fault.", action: { label: "Go to reveal", run: () => scrollTo("panel-reveal") } };
  else if (state.truth) next = { text: "Investigation complete. Start another — try Judge mode to plant your own fault.", action: { label: "New guided demo", run: () => start({ mode: "guided", guided_scenario_id: GUIDED_FULL_ID }) } };

  return (
    <div className="grid gap-4 pb-8 xl:grid-cols-[264px_minmax(0,1fr)_400px]">
      {/* Left rail */}
      <aside className="space-y-4">
        <Panel code="01" title="Scenario">
          <ScenarioControls busy={busy === "create"} active={!!state.scenarioId} onStart={start} onReset={reset} />
        </Panel>
        <Panel title="Investigation" code="◇">
          <WorkflowRail steps={steps} />
        </Panel>
        <Panel title="Activity" code="◇" bodyClassName="max-h-[340px] overflow-y-auto p-4">
          <EventLog entries={state.log} />
        </Panel>
      </aside>

      {/* Center */}
      <main className="min-w-0 space-y-4">
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded border border-accent/40 bg-accent-dim text-accent">
            <ChevronRight size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="micro text-accent/80">Next step</div>
            <div className="text-[13px] text-ink">{next.text}</div>
          </div>
          {next.action && (
            <button className="btn btn-primary" disabled={!!busy} onClick={next.action.run}>
              {busy && busy !== "money" ? <Spinner /> : null}
              {next.action.label}
            </button>
          )}
        </div>

        {state.error && <ErrorNote message={state.error} onRetry={dismissError} />}

        {state.mode === "guided" && (
          <Notice>
            <b className="text-ink-2">Guided scenario disclosure.</b> This walkthrough ({GUIDED_FULL_ID}) is a curated TRAINING example,
            selected because it shows every workflow step; it is not typical performance. The original Bedroom draft example (
            {GUIDED_UNSURE_ID}) stays uncertain after the fan test. Every number below is computed live by the backend — nothing is
            scripted. Use Judge mode for unselected cases.
          </Notice>
        )}

        <Panel
          code="02"
          title={
            <span className="flex items-center gap-2">
              Digital twin <span className="text-ink-4">/</span> <span className="text-ink">HH09</span>
            </span>
          }
          right={<ProvenanceTag value="SIMULATED_MEASUREMENT" />}
          brackets
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#0a1016] px-4 py-2">
            <span className="rounded-[3px] border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.16em] text-accent">
              APPROXIMATE HH09 DIGITAL TWIN
            </span>
            <span className="text-[11px] text-ink-3">
              Simulated indoor temperatures based on an HH09-inspired model and regional historical weather.
            </span>
          </div>
          <div className="relative grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative p-4">
              {busy && busy !== "money" && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
                  <div className="h-full w-1/3 animate-scan bg-gradient-to-r from-transparent via-accent to-transparent" />
                </div>
              )}
              {night ? (
                <TwinView
                  readings={readings}
                  range={range}
                  selected={selected}
                  onSelect={(id) => setSelected((s) => (s === id ? null : id))}
                  flagged={flagged}
                  status={latest?.status ?? null}
                  truthRoom={state.truth?.actual_room_id ?? null}
                  repairedRoom={state.repair && dataset?.repaired ? latest?.flagged_room_id ?? null : null}
                  fanOn={fanOnNow}
                  idle={false}
                />
              ) : (
                <div className="grid min-h-[420px] place-items-center text-center">
                  <div className="max-w-sm space-y-3">
                    <Radar size={36} className="mx-auto text-ink-4" />
                    <div className="text-[14px] text-ink-2">No scenario loaded</div>
                    <p className="text-[12px] leading-relaxed text-ink-3">
                      HeatHunter places virtual sensors in four rooms of an approximate twin of SMETER house HH09, records a cold
                      night with the heating off, and investigates which room is losing heat — and why.
                    </p>
                    {busy === "create" && (
                      <div className="flex items-center justify-center gap-2 text-[12px] text-accent">
                        <Spinner /> Simulating night…
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-line p-4 lg:border-l lg:border-t-0">
              <div className="micro mb-2">Rooms</div>
              <div className="space-y-1">
                {TWIN_ORDER.map((id) => {
                  const r = readings[id];
                  const isFlagged = flagged === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelected((s) => (s === id ? null : id))}
                      className={`flex w-full items-center gap-2 rounded border px-2.5 py-2 text-left transition ${
                        selected === id ? "border-accent/50 bg-accent/5" : "border-line hover:border-line-strong"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: TWIN_ROOMS[id].color }} />
                      <span className="flex-1 text-[12px] text-ink">{TWIN_ROOMS[id].name}</span>
                      {isFlagged && <span className="font-mono text-[9px] tracking-[0.12em]" style={{ color: latest?.status === "confident" ? "var(--color-crit)" : "var(--color-warn)" }}>▲ FLAG</span>}
                      <span className="num text-[12px] text-ink">{r?.temp != null ? `${fmt(r.temp)}°` : "—"}</span>
                    </button>
                  );
                })}
              </div>
              {night && (
                <div className="mt-4 space-y-1.5 text-[11.5px]">
                  <div className="micro mb-1">Protocol</div>
                  <div className="flex justify-between text-ink-3">
                    <span>Heating</span>
                    <span className="num text-ink-2">{protocol?.heating_off ? "OFF" : "ON"}</span>
                  </div>
                  <div className="flex justify-between text-ink-3">
                    <span>Doors</span>
                    <span className="num text-ink-2">{protocol?.doors_closed ? "CLOSED" : "OPEN"}</span>
                  </div>
                  <div className="flex justify-between text-ink-3">
                    <span>Exhaust fan</span>
                    <span className={`num ${fan ? "text-accent" : "text-ink-2"}`}>{fan ? `${fmt(protocol?.fan_airflow_m3_per_h, 0)} m³/h` : "OFF"}</span>
                  </div>
                  <div className="flex justify-between text-ink-3">
                    <span>Sampling</span>
                    <span className="num text-ink-2">5 min</span>
                  </div>
                  <div className="flex justify-between text-ink-3">
                    <span>Outdoor (mean)</span>
                    <span className="num text-ink-2">{fmt(mean(night.weather.outdoor_temperature.values), 1)}°C</span>
                  </div>
                  <div className="flex justify-between text-ink-3">
                    <span>Wind (mean)</span>
                    <span className="num text-ink-2">{fmt(mean(night.weather.wind_speed.values), 1)} m/s</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          {night && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <button className="btn h-8 w-8 p-0" onClick={() => setIndex(0)} aria-label="Rewind to start of night">
                <SkipBack size={13} />
              </button>
              <button
                className="btn btn-primary h-8 w-8 p-0"
                onClick={() => {
                  if (index >= length - 1) setIndex(0);
                  setPlaying((p) => !p);
                }}
                aria-label={playing ? "Pause playback" : "Play night"}
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <input
                type="range"
                className="range min-w-0 flex-1 basis-40"
                min={0}
                max={Math.max(0, length - 1)}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
                style={{ "--fill": `${(index / Math.max(1, length - 1)) * 100}%` } as React.CSSProperties}
                aria-label="Night playback position"
              />
              <span className="num shrink-0 text-right text-[11.5px] text-ink-2">
                {cursorIso ? `${utcDate(cursorIso).slice(0, 6)} ${utcTime(cursorIso)} UTC` : "—"}
              </span>
            </div>
          )}
        </Panel>

        <Panel
          code="02b"
          title="Telemetry"
          right={
            <span className="flex items-center gap-2">
              <ProvenanceTag value="SIMULATED_MEASUREMENT" />
              {night && <ProvenanceTag value={night.weather.outdoor_temperature.provenance} className="hidden sm:inline-flex" />}
            </span>
          }
        >
          {night ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Observation set">
                  {datasets.map((d) => (
                    <button
                      key={d.key}
                      role="tab"
                      aria-selected={d.key === datasetKey}
                      onClick={() => setDatasetKey(d.key)}
                      className={`rounded-[3px] border px-2.5 py-1 text-[11px] ${
                        d.key === datasetKey
                          ? d.repaired
                            ? "border-ok/50 bg-ok/10 text-ink"
                            : "border-accent/50 bg-accent/10 text-ink"
                          : "border-line text-ink-3 hover:text-ink"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <SeriesLegend
                  series={chartSeries}
                  hidden={hidden}
                  focus={selected}
                  onToggle={(key) =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
              </div>
              <TelemetryChart series={chartSeries} fan={fan} cursor={cursorIso} hidden={hidden} height={290} />
              <div className="flex items-center gap-2">
                <span className="micro w-10 shrink-0 leading-tight">Wind<br />m/s</span>
                <div className="min-w-0 flex-1">
                  <WindChart series={night.weather.wind_speed} fan={fan} />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[10.5px] text-ink-4">
                <span>
                  Indoor: <span className="text-prov-sim">simulated measurement</span> (0.15 °C noise, sensor offsets, 0.1 °C rounding, ~1% dropouts)
                </span>
                <span>
                  Weather: {night.weather.source.provider} · {night.weather.location.name} · night {night.weather.night_id}
                </span>
                <span>
                  Source weather is a <span className="text-prov-real">real measurement</span>; half-hourly values are interpolated to 5 min (
                  <span className="text-prov-model">{night.weather.outdoor_temperature.provenance.toLowerCase().replace("_", " ")}</span>).
                </span>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[160px] place-items-center text-[12px] text-ink-4">Telemetry appears once a scenario is loaded.</div>
          )}
        </Panel>
      </main>

      {/* Right stack */}
      <aside className="space-y-4">
        <DiagnosisPanel diagnoses={state.diagnoses} busy={busy === "diagnose"} canDiagnose={state.nights.length > 0} onDiagnose={diagnose} />
        <TestPanel first={first} fanNight={state.nights.find((n) => n.kind === "fan_test")} busy={busy === "experiment"} onRun={runExperiment} />
        <MoneyPanel diagnosis={latest} money={state.money} busy={busy === "money"} onReprice={reprice} />
        <div id="panel-repair">
          <RepairPanel key={state.scenarioId ?? "none"} diagnosis={latest} repair={state.repair} busy={busy === "repair"} onRepair={repair} />
        </div>
        <div id="panel-reveal">
          <RevealPanel key={state.scenarioId ?? "none"} available={!!first} truth={state.truth} busy={busy === "reveal"} onReveal={reveal} />
        </div>
        {latest && (
          <p className="px-1 text-[10.5px] leading-relaxed text-ink-4">
            Scenario {shortId(state.scenarioId)} · flagged {roomName(latest.flagged_room_id)} · preliminary diagnostic concept, not a
            certified energy audit.
          </p>
        )}
      </aside>
    </div>
  );
}

export type LabView = "simple" | "expert";

/** One investigation shared by both views, so switching view never loses progress. */
export function FaultLab({ onMode, view }: { onMode: (label: string | null) => void; view: LabView }) {
  const inv = useInvestigation();
  const twin = useTwinState(inv.state);
  const { mode, scenarioId } = inv.state;
  useEffect(() => {
    onMode(mode ? `${mode.toUpperCase()} · ${shortId(scenarioId)}` : null);
  }, [mode, scenarioId, onMode]);
  return view === "simple" ? <SimpleLab inv={inv} twin={twin} /> : <ExpertLab inv={inv} twin={twin} />;
}
