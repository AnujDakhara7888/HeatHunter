import { Dices, Gavel, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FaultType, ScenarioCreateRequest } from "../../lib/api";
import { CAUSE_LABEL, TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../../lib/rooms";
import { Slider, Spinner } from "../../components/ui";

const GUIDED_ID = "hh09-guided-v1";

function JudgeDialog({ onClose, onLaunch }: { onClose: () => void; onLaunch: (r: ScenarioCreateRequest) => void }) {
  const [fault, setFault] = useState<FaultType>("draft");
  const [room, setRoom] = useState<TwinRoomId>("kitchen");
  const [severity, setSeverity] = useState(2);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal: animated (transformed) panels would otherwise trap position:fixed.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="judge-title"
        className="panel brackets w-full max-w-md outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="judge-title" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink">
            <Gavel size={14} className="text-warn" /> Judge mode · plant a hidden fault
          </h2>
          <button className="btn btn-ghost h-7 w-7 p-0" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>
        <div className="space-y-5 p-5">
          <p className="text-[12px] leading-relaxed text-ink-3">
            Choose the fault to inject into the HH09 twin. After you seal it, the choice is hidden from this screen and from the
            diagnosis engine until you press Reveal.
          </p>
          <fieldset>
            <legend className="micro mb-2">Fault type</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(["draft", "envelope_conduction", "none"] as FaultType[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFault(f)}
                  aria-pressed={fault === f}
                  className={`rounded border px-2 py-2 text-[11.5px] ${fault === f ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}
                >
                  {f === "envelope_conduction" ? "Conduction" : f === "draft" ? "Air leak" : "No fault"}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={fault === "none"} className={fault === "none" ? "opacity-40" : ""}>
            <legend className="micro mb-2">Room</legend>
            <div className="grid grid-cols-4 gap-1.5">
              {TWIN_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRoom(id)}
                  aria-pressed={room === id}
                  className={`flex items-center justify-center gap-1.5 rounded border px-2 py-2 text-[11.5px] ${room === id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink"}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: TWIN_ROOMS[id].color }} />
                  {TWIN_ROOMS[id].name}
                </button>
              ))}
            </div>
          </fieldset>
          <div className={fault === "none" ? "pointer-events-none opacity-40" : ""}>
            <Slider
              label="Severity (excess over healthy)"
              value={severity}
              min={0.2}
              max={3}
              step={0.1}
              display={`+${Math.round(severity * 100)}% · ×${(1 + severity).toFixed(1)}`}
              onChange={setSeverity}
            />
          </div>
          <button
            className="btn btn-warn w-full"
            onClick={() =>
              onLaunch({
                mode: "judge",
                judge_fault_type: fault,
                // The contract requires room/severity even for "none"; the simulator ignores them.
                judge_room_id: room,
                severity: Number(severity.toFixed(2)),
              })
            }
          >
            <ShieldCheck size={15} /> Seal fault &amp; start blind investigation
          </button>
          <p className="text-[10.5px] text-ink-4">
            {fault === "none" ? "Healthy house: " : `${CAUSE_LABEL[fault]}: `}
            {fault === "draft"
              ? "multiplies the room's leakage coefficient."
              : fault === "envelope_conduction"
                ? "multiplies the room's envelope conductance."
                : "no parameter is changed."}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ScenarioControls({
  busy,
  active,
  onStart,
  onReset,
}: {
  busy: boolean;
  active: boolean;
  onStart: (request: ScenarioCreateRequest) => void;
  onReset: () => void;
}) {
  const [judgeOpen, setJudgeOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        className="btn btn-primary w-full justify-start"
        disabled={busy}
        onClick={() => onStart({ mode: "guided", guided_scenario_id: GUIDED_ID })}
      >
        {busy ? <Spinner /> : <Play size={14} />} Guided demo
        <span className="ml-auto font-mono text-[9.5px] tracking-[0.12em] text-accent/70">HH09-V1</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" disabled={busy} onClick={() => setJudgeOpen(true)}>
          <Gavel size={14} /> Judge mode
        </button>
        <button className="btn" disabled={busy} onClick={() => onStart({ mode: "surprise" })}>
          <Dices size={14} /> Surprise me
        </button>
      </div>
      <button className="btn btn-ghost w-full" disabled={!active || busy} onClick={onReset}>
        <RotateCcw size={13} /> Reset
      </button>
      {judgeOpen && (
        <JudgeDialog
          onClose={() => setJudgeOpen(false)}
          onLaunch={(request) => {
            setJudgeOpen(false);
            onStart(request);
          }}
        />
      )}
    </div>
  );
}
