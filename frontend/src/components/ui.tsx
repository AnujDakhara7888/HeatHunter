import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle, Loader2, ShieldAlert, XCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { DiagnosisStatus, Provenance } from "../lib/api";

export function Panel({
  code,
  title,
  right,
  children,
  className = "",
  bodyClassName = "p-4",
  brackets = false,
  tone,
}: {
  code?: string;
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  brackets?: boolean;
  tone?: "warn" | "ok" | "accent";
}) {
  const toneBar =
    tone === "warn"
      ? "bg-warn"
      : tone === "ok"
        ? "bg-ok"
        : tone === "accent"
          ? "bg-accent"
          : "bg-transparent";
  return (
    <section className={`panel ${brackets ? "brackets" : ""} animate-fade-up ${className}`}>
      <span className={`absolute left-0 top-3 h-4 w-[2px] rounded-r ${toneBar}`} aria-hidden />
      <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-4 py-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-2">
          {code && <span className="num text-[10px] font-normal text-ink-4">{code}</span>}
          {title}
        </h2>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const PROV: Record<Provenance, { label: string; color: string }> = {
  REAL_MEASUREMENT: { label: "Real measurement", color: "var(--color-prov-real)" },
  SIMULATED_MEASUREMENT: { label: "Simulated measurement", color: "var(--color-prov-sim)" },
  SIMULATED_GROUND_TRUTH: { label: "Simulated ground truth", color: "var(--color-prov-truth)" },
  MODEL_ESTIMATE: { label: "Model estimate", color: "var(--color-prov-model)" },
  ASSUMPTION: { label: "Assumption", color: "var(--color-prov-assume)" },
};

export function ProvenanceTag({ value, className = "" }: { value: Provenance; className?: string }) {
  const p = PROV[value];
  return (
    <span
      title={`Provenance: ${value}`}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.12em] ${className}`}
      style={{ color: p.color, borderColor: `color-mix(in srgb, ${p.color} 35%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
      {p.label}
    </span>
  );
}

export const STATUS_META: Record<
  DiagnosisStatus,
  { label: string; color: string; bg: string; icon: typeof CheckCircle2; blurb: string }
> = {
  no_fault: {
    label: "No fault detected",
    color: "var(--color-ok)",
    bg: "var(--color-ok-dim)",
    icon: CheckCircle2,
    blurb: "No room's cooling is explained materially better by a fault than by normal behaviour.",
  },
  ambiguous: {
    label: "Ambiguous",
    color: "var(--color-warn)",
    bg: "var(--color-warn-dim)",
    icon: HelpCircle,
    blurb: "A room is losing heat abnormally, but the leading explanations are too close to call.",
  },
  confident: {
    label: "Confident",
    color: "var(--color-crit)",
    bg: "var(--color-crit-dim)",
    icon: ShieldAlert,
    blurb: "One explanation fits the measurements clearly better than the alternatives.",
  },
  unexplained: {
    label: "Unexplained",
    color: "var(--color-info)",
    bg: "rgba(122,167,255,0.08)",
    icon: CircleSlash,
    blurb: "None of our available models adequately explains these measurements. More evidence is needed.",
  },
};

export function StatusBadge({ status, size = "md" }: { status: DiagnosisStatus; size?: "md" | "lg" }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border font-mono uppercase tracking-[0.14em] ${
        size === "lg" ? "px-2.5 py-1 text-[11.5px]" : "px-2 py-0.5 text-[10px]"
      }`}
      style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)` }}
    >
      <Icon size={size === "lg" ? 14 : 12} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="micro mb-1 truncate">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="num truncate text-[22px] font-medium leading-none tracking-tight" style={{ color: tone }}>
          {value}
        </span>
        {unit && <span className="num text-[11px] text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: string;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className={`block ${disabled ? "opacity-50" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="micro">{label}</span>
        <span className="num text-[12px] text-ink">{display}</span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        aria-label={label}
      />
    </label>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded border border-crit/40 bg-crit-dim px-3 py-2 text-[12px] text-[#ffc9c8]">
      <XCircle size={14} className="mt-0.5 shrink-0 text-crit" />
      <div className="min-w-0 flex-1">{message}</div>
      {onRetry && (
        <button className="btn btn-ghost h-6 px-2 text-[11px]" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const warn = tone === "warn";
  return (
    <div
      className={`flex items-start gap-2 rounded border px-3 py-2 text-[11.5px] leading-relaxed ${
        warn ? "border-warn/35 bg-warn-dim text-[#f6d79c]" : "border-line bg-sunken text-ink-2"
      }`}
    >
      {warn ? (
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
      ) : (
        <HelpCircle size={13} className="mt-0.5 shrink-0 text-ink-3" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Locked({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded border border-dashed border-line px-3 py-3 text-[12px] text-ink-3">
      <span className="h-1.5 w-1.5 rounded-full bg-ink-4" />
      {children}
    </div>
  );
}

export function KeyValue({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="text-[11.5px] text-ink-3">{k}</span>
      <span className={`text-right text-[12px] text-ink ${mono ? "num" : ""}`}>{v}</span>
    </div>
  );
}
