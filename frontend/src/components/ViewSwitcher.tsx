import { motion } from "framer-motion";
import { useScene, type View } from "../store/scene";

const LABELS: Record<View, string> = {
  exterior: "Outside",
  thermal: "Thermal",
  open: "Open house",
  inside: "Walk in",
  fan: "Fan test",
  top: "Plan",
};

export function ViewSwitcher({ views, className = "" }: { views: View[]; className?: string }) {
  const view = useScene((s) => s.view);
  const set = useScene((s) => s.set);
  return (
    <div className={`glass flex gap-1 rounded-full p-1 text-[13px] ${className}`}>
      {views.map((v) => (
        <button key={v} onClick={() => set({ view: v, fanOn: v === "fan" })} className="relative rounded-full px-3.5 py-1.5">
          {view === v && <motion.span layoutId="view-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.5 }} />}
          <span className={`relative ${view === v ? "font-semibold text-black" : "text-mute hover:text-ink"}`}>{LABELS[v]}</span>
        </button>
      ))}
    </div>
  );
}
