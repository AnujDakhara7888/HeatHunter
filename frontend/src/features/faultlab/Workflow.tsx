import { ArrowRight, Check, CircleDot, Minus } from "lucide-react";
import type { Investigation, LogEntry } from "./useInvestigation";

type StepState = "done" | "active" | "skipped" | "locked";

export interface Step {
  key: string;
  label: string;
  state: StepState;
}

export function deriveSteps(s: Investigation): Step[] {
  const first = s.diagnoses[0];
  const latest = s.diagnoses[s.diagnoses.length - 1];
  const loaded = s.nights.length > 0;
  const recommended = !!first?.test_decision?.recommended;
  const confident = latest?.status === "confident";
  const finished = !!s.truth;
  const st = (done: boolean, active: boolean, skipped = false): StepState =>
    done ? "done" : skipped ? "skipped" : active ? "active" : "locked";
  return [
    { key: "evidence", label: "Collect evidence", state: st(loaded, !loaded) },
    { key: "diagnose", label: "Diagnose heat loss", state: st(!!first, loaded && !first) },
    {
      key: "test",
      label: "Decide on extra test",
      state: st(!!first && (s.experimentRun || !recommended), !!first && recommended && !s.experimentRun),
    },
    {
      key: "experiment",
      label: "Run experiment",
      state: st(s.experimentRun, !!first && recommended && !s.experimentRun, !!first && !recommended),
    },
    { key: "cost", label: "Review cost", state: st(confident && !!latest?.money_estimate, false, !!first && !confident && (finished || !recommended || s.experimentRun)) },
    { key: "repair", label: "Repair & verify", state: st(!!s.repair, confident && !s.repair, !!first && !confident && (finished || !recommended || s.experimentRun)) },
    { key: "reveal", label: "Reveal answer", state: st(finished, !!first && !finished) },
  ];
}

export function WorkflowRail({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative space-y-0.5">
      {steps.map((step, i) => {
        const icon =
          step.state === "done" ? (
            <Check size={11} strokeWidth={3} />
          ) : step.state === "active" ? (
            <CircleDot size={11} />
          ) : step.state === "skipped" ? (
            <Minus size={11} />
          ) : (
            <span className="num text-[9.5px]">{i + 1}</span>
          );
        const color =
          step.state === "done"
            ? "border-accent/60 bg-accent/15 text-accent"
            : step.state === "active"
              ? "border-warn/70 bg-warn-dim text-warn"
              : "border-line text-ink-4";
        return (
          <li key={step.key} className="relative flex items-center gap-3 py-1.5">
            {i < steps.length - 1 && <span className="absolute left-[10.5px] top-[26px] h-[14px] w-px bg-line" aria-hidden />}
            <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[4px] border ${color}`}>{icon}</span>
            <span
              className={`text-[12px] ${
                step.state === "active" ? "font-medium text-ink" : step.state === "done" ? "text-ink-2" : "text-ink-4"
              } ${step.state === "skipped" ? "line-through decoration-ink-4/60" : ""}`}
            >
              {step.label}
            </span>
            {step.state === "active" && <ArrowRight size={12} className="ml-auto text-warn" />}
          </li>
        );
      })}
    </ol>
  );
}

const TONE: Record<LogEntry["tone"], string> = {
  info: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  muted: "text-ink-3",
};

export function EventLog({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return <div className="px-1 py-2 text-[11.5px] text-ink-4">No activity yet. Every backend call is recorded here.</div>;
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="animate-fade-up border-l border-line pl-2.5">
          <div className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.1em]">
            <span className="text-ink-4">{e.time}Z</span>
            <span className={TONE[e.tone]}>{e.action}</span>
            {e.ms !== undefined && <span className="ml-auto text-ink-4">{e.ms} ms</span>}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-2">{e.detail}</div>
        </li>
      ))}
    </ol>
  );
}
