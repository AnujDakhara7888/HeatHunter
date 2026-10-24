import { CheckCircle2, Eye, Lock, MinusCircle, XCircle } from "lucide-react";
import { useState } from "react";
import type { GroundTruth } from "../../lib/api";
import { fmt } from "../../lib/format";
import { CAUSE_LABEL, roomName } from "../../lib/rooms";
import { KeyValue, Panel, ProvenanceTag, Spinner } from "../../components/ui";

function Verdict({ value, yes, no, none }: { value: boolean | null; yes: string; no: string; none: string }) {
  if (value === null)
    return (
      <span className="flex items-center gap-1.5 text-ink-3">
        <MinusCircle size={14} /> {none}
      </span>
    );
  return value ? (
    <span className="flex items-center gap-1.5 text-ok">
      <CheckCircle2 size={14} /> {yes}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-warn">
      <XCircle size={14} /> {no}
    </span>
  );
}

export function RevealPanel({
  available,
  truth,
  busy,
  onReveal,
}: {
  available: boolean;
  truth: GroundTruth | null;
  busy: boolean;
  onReveal: () => void;
}) {
  const [arming, setArming] = useState(false);

  if (truth) {
    return (
      <Panel code="07" title="Ground truth" right={<ProvenanceTag value="SIMULATED_GROUND_TRUTH" />} tone={truth.diagnosis_matched ? "ok" : "warn"}>
        <div className="space-y-3">
          <div className="rounded border border-[color-mix(in_srgb,var(--color-prov-truth)_35%,transparent)] bg-[#1c1608] px-3 py-1">
            <KeyValue k="Injected fault" v={CAUSE_LABEL[truth.fault_type]} mono={false} />
            <KeyValue k="Affected room" v={roomName(truth.actual_room_id)} mono={false} />
            <KeyValue
              k="Severity"
              v={truth.fault_type === "none" ? "—" : `+${fmt(truth.severity * 100, 0)}% excess (×${fmt(1 + truth.severity, 1)})`}
            />
          </div>
          <div className="space-y-1.5 text-[12.5px]">
            <Verdict value={truth.diagnosis_matched} yes="Final diagnosis matched the hidden fault" no="Final diagnosis did not match the hidden fault" none="" />
            <Verdict
              value={truth.repair_addressed_cause}
              yes="The applied repair addressed the actual cause"
              no="The applied repair did not address the actual cause"
              none="No repair was applied"
            />
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink-4">
            Simulated ground truth for the approximate HH09 twin. It says nothing about faults in the real HH09 house.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel code="07" title="Ground truth">
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded border border-dashed border-line-strong bg-sunken px-3 py-3">
          <Lock size={18} className="text-ink-3" />
          <div className="text-[12px] leading-snug text-ink-2">
            The hidden fault is sealed in a separate truth store. The diagnosis engine never sees it.
          </div>
        </div>
        {arming ? (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" onClick={() => setArming(false)}>
              Keep investigating
            </button>
            <button
              className="btn btn-warn"
              disabled={busy}
              onClick={() => {
                setArming(false);
                onReveal();
              }}
            >
              {busy ? <Spinner /> : <Eye size={14} />} Confirm reveal
            </button>
          </div>
        ) : (
          <button className="btn w-full" disabled={!available || busy} onClick={() => setArming(true)}>
            <Eye size={14} /> Reveal answer
          </button>
        )}
        {!available && <p className="text-[11px] text-ink-4">Run at least one diagnosis before revealing.</p>}
      </div>
    </Panel>
  );
}
