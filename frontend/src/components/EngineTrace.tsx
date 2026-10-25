import { AnimatePresence, motion } from "framer-motion";
import { useTrace } from "../store/trace";

/** Live log of every engine call: proof that answers are computed on request. */
export function EngineTrace({ className = "" }: { className?: string }) {
  const entries = useTrace((s) => s.entries).slice(-5);
  if (!entries.length) return null;
  return (
    <div className={`glass rounded-2xl px-3 py-2.5 font-mono text-[10.5px] leading-relaxed ${className}`}>
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-ok pulse-dot" /> engine · live calls
      </div>
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex gap-2 whitespace-nowrap"
          >
            <span className={e.ms == null ? "text-warm" : e.failed ? "text-hot" : "text-ok"}>{e.ms == null ? "…" : e.failed ? "✕" : "✓"}</span>
            <span className="text-ink/90">{e.route}</span>
            <span className="text-dim">{e.ms == null ? "running" : `${Math.round(e.ms)} ms`}</span>
            {e.detail && <span className="max-w-64 truncate text-mute">· {e.detail}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
