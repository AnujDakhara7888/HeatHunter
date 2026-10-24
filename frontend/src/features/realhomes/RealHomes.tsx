import { ExternalLink, Maximize2, ShieldQuestion, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiRequestError, FLOOR_PLAN_URL, type RealHouse } from "../../lib/api";
import { fmt, utcDate } from "../../lib/format";
import { REAL_ROOMS, TWIN_ROOMS } from "../../lib/rooms";
import { SeriesLegend, TelemetryChart, WindChart, type ChartSeries } from "../../components/TelemetryChart";
import { ErrorNote, KeyValue, Notice, Panel, ProvenanceTag, Spinner, Stat } from "../../components/ui";

const humanize = (name: string) => name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function useRealHouse() {
  const [house, setHouse] = useState<RealHouse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api
      .realHouse()
      .then((h) => live && setHouse(h))
      .catch((e) => live && setError(e instanceof ApiRequestError ? `${e.message} [${e.code}]` : String(e)));
    return () => {
      live = false;
    };
  }, [attempt]);
  return { house, error, retry: () => setAttempt((a) => a + 1) };
}

export function RealHomes() {
  const { house, error, retry } = useRealHouse();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [planFailed, setPlanFailed] = useState(false);

  const series: ChartSeries[] = useMemo(() => {
    if (!house) return [];
    // Fixed entity order keeps each room's validated colour slot.
    const order = Object.keys(REAL_ROOMS);
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const rooms: ChartSeries[] = Object.entries(house.room_temperature_series)
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([id, s]) => ({
        key: id,
        label: REAL_ROOMS[id]?.name ?? humanize(id),
        color: REAL_ROOMS[id]?.color ?? "#a7b3c2",
        series: s,
        dotted: REAL_ROOMS[id]?.twinSlot === null,
        emphasis: focus ? (focus === id ? "focus" : "dim") : "normal",
        endLabel: focus === id,
      }));
    return [...rooms, { key: "outdoor", label: "Outdoor", color: "var(--color-outdoor)", dashed: true, series: house.outdoor_temperature, endLabel: true }];
  }, [house, focus]);

  if (error)
    return (
      <div className="mx-auto max-w-xl pt-16">
        <ErrorNote message={`Real-house data could not be loaded: ${error}`} onRetry={retry} />
      </div>
    );
  if (!house)
    return (
      <div className="grid min-h-[50vh] place-items-center text-[12px] text-accent">
        <span className="flex items-center gap-2">
          <Spinner /> Loading SMETER HH09…
        </span>
      </div>
    );

  const chars = house.characteristics;
  const floorArea = chars.find((c) => c.name === "total_floor_area");

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-[3px] border border-ok/40 bg-ok/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.16em] text-ok">
            REAL HH09 MEASUREMENTS
          </span>
          <span className="text-[13px] text-ink">Actual indoor sensor readings and matching weather from SMETER HH09.</span>
        </div>
        <span className="num text-[11px] text-ink-3">
          {utcDate(house.measurement_start)} → {utcDate(house.measurement_end)} · {house.outdoor_temperature.values.length} half-hourly samples
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel
          code="R1"
          title="Original floor plan"
          right={
            <button className="btn btn-ghost h-7 px-2 text-[11px]" onClick={() => setZoom(true)} disabled={planFailed}>
              <Maximize2 size={12} /> Enlarge
            </button>
          }
          bodyClassName="p-3"
        >
          {planFailed ? (
            <Notice>The floor-plan image is not available from the backend.</Notice>
          ) : (
            <button className="block aspect-[1240/1220] w-full overflow-hidden rounded bg-white" onClick={() => setZoom(true)} aria-label="Enlarge floor plan">
              <img src={FLOOR_PLAN_URL} alt="Published SMETER Phase 2 floor plan of HH09" className="h-full w-full object-cover object-top" onError={() => setPlanFailed(true)} />
            </button>
          )}
          <p className="mt-2 text-[10.5px] text-ink-4">SMETER_P2_Floorplans.pdf, page 9 — reproduced from the published dataset.</p>
        </Panel>

        <div className="space-y-4">
          <Panel code="R2" title="Measured whole-building performance" right={<ProvenanceTag value="REAL_MEASUREMENT" />}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Heat-transfer coeff." value={house.reference_htc ? fmt(house.reference_htc.value, 0) : "—"} unit={house.reference_htc?.unit} sub={house.reference_htc?.method ?? "not available"} />
              <Stat label="Airtightness" value={house.airtightness ? fmt(house.airtightness.value, 2) : "—"} unit={house.airtightness?.unit} sub={house.airtightness?.method ?? "not available"} />
              <Stat label="Floor area" value={floorArea ? fmt(Number(floorArea.value), 1) : "—"} unit={floorArea?.unit ?? undefined} sub="documented" />
              <Stat label="Room sensors" value={Object.keys(house.room_temperature_series).length} sub="indoor temperature" />
            </div>
          </Panel>
          <Panel code="R3" title="Documented characteristics" right={<ProvenanceTag value="REAL_MEASUREMENT" />}>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {chars.map((c) => (
                <KeyValue key={c.name} k={humanize(c.name)} v={`${typeof c.value === "number" ? fmt(c.value, Number.isInteger(c.value) ? 0 : 2) : String(c.value)}${c.unit ? ` ${c.unit}` : ""}`} />
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel code="R4" title="Room temperatures · 7 days" right={<ProvenanceTag value="REAL_MEASUREMENT" />}>
        <div className="space-y-3">
          <SeriesLegend
            series={series}
            hidden={hidden}
            focus={focus}
            onHover={setFocus}
            onToggle={(key) =>
              setHidden((h) => {
                const next = new Set(h);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
          <TelemetryChart series={series} hidden={hidden} height={320} />
          <div className="flex items-center gap-2">
            <span className="micro w-10 shrink-0 leading-tight">Wind<br />m/s</span>
            <div className="min-w-0 flex-1">
              <WindChart series={house.wind_speed} height={90} />
            </div>
          </div>
          <p className="border-t border-line pt-2 text-[10.5px] text-ink-4">{house.timestamp_notes} The daily warm-up peaks suggest normal heating use; these are not controlled heating-off test nights.</p>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel code="R5" title="How the Fault Lab twin relates to HH09">
          <div className="space-y-3">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="micro">
                  <th className="py-1.5 font-normal">Real HH09 room</th>
                  <th className="py-1.5 font-normal">Twin slot</th>
                  <th className="py-1.5 font-normal">In twin</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(REAL_ROOMS).map(([id, meta]) => (
                  <tr key={id} className="border-t border-line/70">
                    <td className="py-1.5">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} />
                      {meta.name}
                    </td>
                    <td className="num py-1.5 text-ink-3">{meta.twinSlot ?? "—"}</td>
                    <td className="py-1.5 text-ink-2">{meta.twinSlot ? TWIN_ROOMS[meta.twinSlot].name : "Not modelled (four-room twin)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              The twin uses HH09's documented room areas, plan dimensions, windows and adjacency. Ceiling height, thermal mass,
              conductances and leakage are <b className="text-ink-2">assumptions</b>. Real indoor temperatures are never used as
              synthetic observations, and the measured HTC is not split into per-room values.
            </p>
          </div>
        </Panel>
        <Panel code="R6" title="Source & scientific limits">
          <div className="space-y-3 text-[12px] leading-relaxed text-ink-2">
            <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn-dim px-3 py-2 text-[#f6d79c]">
              <ShieldQuestion size={15} className="mt-0.5 shrink-0 text-warn" />
              <span>{house.scientific_disclaimer} No room-level fault is claimed for HH09.</span>
            </div>
            <div>
              <div className="font-medium text-ink">{house.source.dataset}</div>
              <div className="text-ink-3">{house.source.citation}</div>
              {house.source.notes && <div className="mt-1 text-[11px] text-ink-4">{house.source.notes}</div>}
              {house.source.url && (
                <a href={house.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline">
                  UK Data Service record <ExternalLink size={11} />
                </a>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="Floor plan">
          <button className="btn absolute right-4 top-4 h-8 w-8 p-0" onClick={() => setZoom(false)} aria-label="Close">
            <X size={14} />
          </button>
          <img src={FLOOR_PLAN_URL} alt="Published SMETER Phase 2 floor plan of HH09" className="max-h-[92vh] max-w-full rounded bg-white" />
        </div>
      )}
    </div>
  );
}
