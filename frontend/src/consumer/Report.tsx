import { Printer, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Investigation } from "../features/faultlab/useInvestigation";
import { numericAssumption } from "../lib/assumptions";
import { fmt, gbp } from "../lib/format";
import { useRegisterModal } from "../lib/modal";
import { roomName } from "../lib/rooms";
import { WhyChart, whySentence } from "./WhyChart";

const CAUSE: Record<string, { name: string; fix: string; steps: string[] }> = {
  draft: {
    name: "a draft (air leaking in)",
    fix: "Seal the gaps",
    steps: [
      "Get a quote for draught-proofing this room: window and door seals, gaps in floorboards and skirting.",
      "Check where pipes and cables pass through walls and floors, and seal any gaps.",
      "Don't block air bricks or vents a room needs; ask an installer if unsure.",
    ],
  },
  envelope_conduction: {
    name: "poor insulation (heat escaping through walls, ceiling or floor)",
    fix: "Add insulation",
    steps: [
      "Ask an insulation installer to assess this room's walls, ceiling/loft and floor.",
      "Compare quotes for the options they recommend, and check for available grants.",
      "Re-check the room after the work to confirm it holds its heat.",
    ],
  },
};

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 py-2 text-[13.5px] last:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-semibold text-slate-900">{v}</span>
    </div>
  );
}

export function Report({ state, onClose }: { state: Investigation; onClose: () => void }) {
  useRegisterModal();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const latest = state.diagnoses[state.diagnoses.length - 1];
  if (!latest) return null;
  const roomId = latest.flagged_room_id;
  const room = roomName(roomId);
  const lead = latest.ranked_causes[0]?.fault_type;
  const cause = lead ? CAUSE[lead] : undefined;
  const money = state.money && state.money.diagnosis_id === latest.diagnosis_id && state.money.estimate ? state.money.estimate : latest.money_estimate;
  const fx = numericAssumption(money?.assumptions, "gbp_to_usd");
  const price = numericAssumption(money?.assumptions, "gas_unit_price");
  const repairText = state.repair?.diagnosed_improvement ?? "";
  const cleared = /status: no_fault/.test(repairText);
  const delta = Number(repairText.match(/change ([+-]?[\d.]+) degC/)?.[1] ?? NaN);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const verdict =
    latest.status === "confident"
      ? { title: `Problem found: ${cause?.name ?? "heat loss"} in the ${room}`, tone: "bg-orange-50 border-orange-200 text-orange-900" }
      : latest.status === "ambiguous"
        ? { title: `The ${room} is losing heat too fast — cause not certain`, tone: "bg-amber-50 border-amber-200 text-amber-900" }
        : latest.status === "no_fault"
          ? { title: "No unusual heat loss found", tone: "bg-emerald-50 border-emerald-200 text-emerald-900" }
          : { title: "Inconclusive — the readings didn't match a known problem", tone: "bg-slate-50 border-slate-200 text-slate-800" };
  const sureness =
    latest.status === "confident"
      ? state.experimentRun
        ? "Confident — confirmed with a fan test"
        : "Confident"
      : latest.status === "ambiguous"
        ? `Not sure — a draft and poor insulation both fit${state.experimentRun ? ", even after a fan test" : ""}`
        : latest.status === "no_fault"
          ? "Every room cooled as a healthy home would"
          : "HeatHunter couldn't explain these readings, so it didn't guess";

  return createPortal(
    <div className="print-portal fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="mx-auto max-w-[820px]" onClick={(e) => e.stopPropagation()}>
        <div className="no-print mb-3 flex justify-end gap-2">
          <button className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[14px] font-semibold text-black hover:bg-white/90" onClick={() => window.print()}>
            <Printer size={16} /> Print or save as PDF
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-white hover:bg-white/25" onClick={onClose} aria-label="Close report">
            <X size={18} />
          </button>
        </div>

        <article className="report-paper rounded-2xl bg-white p-8 text-slate-900 shadow-2xl sm:p-10">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden>
                <rect width="32" height="32" rx="9" fill="#ea580c" />
                <path d="M8 17 16 9.5 24 17v7H8z" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
                <circle cx="16" cy="19.5" r="2.4" fill="#fff" />
              </svg>
              <div>
                <div className="text-[22px] font-bold tracking-tight">Home Heat Report</div>
                <div className="text-[13px] text-slate-500">HeatHunter · {today}</div>
              </div>
            </div>
            <div className="text-right text-[12.5px] text-slate-500">
              Example home
              <br />
              Detached bungalow, England
              <br />
              <span className="text-slate-400">(simulated)</span>
            </div>
          </header>

          <section className={`mt-6 rounded-xl border px-5 py-4 ${verdict.tone}`}>
            <div className="text-[12px] font-semibold uppercase tracking-wide opacity-70">Result</div>
            <div className="mt-1 text-[20px] font-bold leading-snug">{verdict.title}</div>
            <div className="mt-1 text-[14px]">{sureness}</div>
          </section>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {money && fx ? (
              <section>
                <h2 className="text-[14px] font-bold uppercase tracking-wide text-slate-500">What it may cost you</h2>
                <div className="mt-2">
                  <Row k="Estimated cost per year" v={gbp(money.annual_cost_estimate_usd / fx)} />
                  <Row k="Extra gas per year" v={`${fmt(money.annual_energy_estimate_kwh, 0)} kWh`} />
                  <Row k={`${cause?.fix ?? "Fix"} (typical quote)`} v={gbp(money.repair_cost_usd / fx)} />
                  <Row k="Pays for itself in" v={money.simple_payback_years != null ? `${fmt(money.simple_payback_years, 1)} years` : "—"} />
                  {price != null && <Row k="Gas price used" v={`${fmt(price, 2)}p per kWh`} />}
                </div>
              </section>
            ) : (
              <section>
                <h2 className="text-[14px] font-bold uppercase tracking-wide text-slate-500">What it may cost you</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">No cost estimate: HeatHunter only prices a problem it can identify with confidence.</p>
              </section>
            )}
            <section>
              <h2 className="text-[14px] font-bold uppercase tracking-wide text-slate-500">Fix tested</h2>
              {state.repair ? (
                <div className="mt-2">
                  <Row k="Fix applied" v={`${cause?.fix ?? "Repair"} (${Math.round(state.repair.effectiveness * 100)}% thorough)`} />
                  <Row k="Result" v={cleared ? "Problem cleared" : "No clear improvement"} />
                  {Number.isFinite(delta) && <Row k={`${room} on the same night`} v={`${delta >= 0 ? "+" : ""}${fmt(delta, 1)}°C warmer on average`} />}
                  {state.repair.remeasured_savings_kwh != null && state.repair.remeasured_savings_kwh > 0 && (
                    <Row k="Gas saved per year" v={`about ${fmt(state.repair.remeasured_savings_kwh, 0)} kWh`} />
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">No fix was tested in this check.</p>
              )}
            </section>
          </div>

          {roomId && (latest.status === "confident" || latest.status === "ambiguous") && (
            <section className="mt-7 break-inside-avoid">
              <h2 className="text-[14px] font-bold uppercase tracking-wide text-slate-500">Why we think so</h2>
              <div className="mt-3 grid gap-5 sm:grid-cols-2">
                {state.nights.map((n) => (
                  <div key={n.night_id + n.kind}>
                    <div className="text-[13px] font-semibold">{n.kind === "fan_test" ? "Fan test night" : "First night (heating off)"}</div>
                    <p className="mb-2 mt-0.5 text-[12.5px] leading-snug text-slate-600">{whySentence(n, roomId)}</p>
                    <WhyChart night={n} roomId={roomId} light height={150} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-7 break-inside-avoid">
            <h2 className="text-[14px] font-bold uppercase tracking-wide text-slate-500">Next steps</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-slate-700">
              {latest.status === "confident" && cause
                ? cause.steps.map((s) => <li key={s}>{s}</li>)
                : latest.status === "ambiguous"
                  ? [
                      "Ask a professional for an airtightness (blower-door) test to tell a draft from poor insulation.",
                      "Hold off on expensive work until the cause is clear.",
                    ].map((s) => <li key={s}>{s}</li>)
                  : [<li key="none">Nothing to fix right now. Re-check after any building work or if a room starts feeling cold.</li>]}
              <li>If you use a gas or wood burner, never run extractor-fan tests yourself without a safety check.</li>
            </ol>
          </section>

          {state.truth && (
            <section className="mt-7 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-[13.5px] break-inside-avoid">
              <span className="font-semibold">Demo answer: </span>
              {state.truth.fault_type === "none"
                ? "this example home had no hidden problem."
                : `the hidden problem was ${CAUSE[state.truth.fault_type]?.name ?? state.truth.fault_type} in the ${roomName(state.truth.actual_room_id)}.`}{" "}
              {state.truth.diagnosis_matched ? "HeatHunter's result matched." : "HeatHunter's final result did not match."}
            </section>
          )}

          <footer className="mt-8 border-t border-slate-200 pt-4 text-[11.5px] leading-relaxed text-slate-400">
            This example home is a simulation modelled on a real bungalow from a UK research study; the problem was planted for the demonstration.
            Costs are estimates based on stated assumptions (UK gas price cap, the home's boiler efficiency, typical repair quotes). This is not a
            professional energy assessment.
          </footer>
        </article>
      </div>
    </div>,
    document.body,
  );
}
