import { EyeOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FaultType, ScenarioCreateRequest } from "../lib/api";
import { useRegisterModal } from "../lib/modal";
import { TWIN_ORDER, TWIN_ROOMS, type TwinRoomId } from "../lib/rooms";

const LEVELS = [
  { label: "Mild", severity: 0.6 },
  { label: "Moderate", severity: 1.5 },
  { label: "Severe", severity: 3.0 },
];

export function ChallengeDialog({ onClose, onStart }: { onClose: () => void; onStart: (r: ScenarioCreateRequest) => void }) {
  useRegisterModal();
  const [problem, setProblem] = useState<FaultType>("draft");
  const [room, setRoom] = useState<TwinRoomId>("kitchen");
  const [level, setLevel] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choice = (active: boolean) =>
    `rounded-2xl border px-3 py-3 text-left text-[14px] transition ${active ? "border-orange-400 bg-orange-400/10 text-white" : "border-white/10 text-white/70 hover:border-white/25 hover:text-white"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="challenge-title" className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#141a22] p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-white/50 hover:bg-white/5 hover:text-white" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2 id="challenge-title" className="text-[22px] font-semibold text-white">
          Hide a problem
        </h2>
        <p className="mt-1 text-[14px] text-white/60">Pick a problem and a room. We'll keep it secret — HeatHunter has to find it on its own.</p>

        <div className="mt-6 text-[13px] font-medium text-white/80">What's wrong?</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(
            [
              ["draft", "A draft", "air leaking in"],
              ["envelope_conduction", "Poor insulation", "heat escaping"],
              ["none", "Nothing", "a healthy home"],
            ] as const
          ).map(([value, title, sub]) => (
            <button key={value} className={choice(problem === value)} onClick={() => setProblem(value)} aria-pressed={problem === value}>
              <div className="font-semibold">{title}</div>
              <div className="text-[12px] text-white/50">{sub}</div>
            </button>
          ))}
        </div>

        <div className={problem === "none" ? "pointer-events-none opacity-35" : ""}>
          <div className="mt-5 text-[13px] font-medium text-white/80">Which room?</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TWIN_ORDER.map((id) => (
              <button key={id} className={choice(room === id)} onClick={() => setRoom(id)} aria-pressed={room === id}>
                {TWIN_ROOMS[id].name}
              </button>
            ))}
          </div>
          <div className="mt-5 text-[13px] font-medium text-white/80">How bad?</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {LEVELS.map((l, i) => (
              <button key={l.label} className={choice(level === i)} onClick={() => setLevel(i)} aria-pressed={level === i}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-400 to-orange-600 text-[15px] font-semibold text-white shadow-lg shadow-orange-900/40 hover:from-orange-300"
          onClick={() =>
            onStart({
              mode: "judge",
              judge_fault_type: problem,
              // The service requires a room and severity even for a healthy home; it ignores them then.
              judge_room_id: room,
              severity: LEVELS[level].severity,
            })
          }
        >
          <EyeOff size={17} /> Hide it and start the check
        </button>
      </div>
    </div>,
    document.body,
  );
}
