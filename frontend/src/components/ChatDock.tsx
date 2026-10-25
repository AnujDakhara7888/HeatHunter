import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ApiError, api, traced } from "../api/client";
import type { ChatAction } from "../api/types";
import { useScene, type View } from "../store/scene";

type Msg = { role: "user" | "assistant"; content: string; offline?: boolean };

/** What the current page has shown the user. The assistant sees only this. */
export const useChatContext = create<{
  context: Record<string, unknown>;
  suggestions: string[];
  setContext: (c: Record<string, unknown>, suggestions?: string[]) => void;
}>((set) => ({
  context: {},
  suggestions: [],
  setContext: (context, suggestions) => set((s) => ({ context, suggestions: suggestions ?? s.suggestions })),
}));

const VIEWS: Record<string, View> = { exterior: "exterior", thermal: "thermal", open: "open", inside: "inside", fan: "fan", top: "top" };

function applyActions(actions: ChatAction[]) {
  const { set, plan } = useScene.getState();
  for (const a of actions) {
    if (a.type === "set_view" && VIEWS[a.target]) set({ view: VIEWS[a.target], fanOn: a.target === "fan" });
    if (a.type === "focus_room") {
      const room =
        plan.rooms.find((r) => r.room_id === a.target) ??
        plan.rooms.find((r) => r.name.toLowerCase() === a.target.toLowerCase());
      const mapped = room?.room_id ?? ({ bedroom_1: "bedroom", bedroom_2: "hall" } as Record<string, string>)[a.target];
      if (mapped) set({ focusRoom: mapped });
    }
  }
}

/** Grounded fallback when no Claude key is configured: answers only from the shown state. */
function offlineAnswer(q: string, ctx: Record<string, unknown>): { text: string; actions: ChatAction[] } {
  const s = q.toLowerCase();
  const d = ctx as {
    flagged_room?: string;
    status?: string;
    leading_cause?: string;
    runner_up?: string;
    bic_gap?: number;
    multiplier?: number;
    annual_cost?: string;
    payback_years?: number;
  };
  if (/draft|leak|insulat|differ/.test(s))
    return {
      text: "A leak lets cold outside air in, so it gets worse with wind and with a fan pulling air through the house. Weak insulation lets heat soak out through the wall, which a fan barely changes. That difference is why HeatHunter can tell them apart with the fan test.",
      actions: [{ type: "set_view", target: "fan" }],
    };
  if (/why|which room|where/.test(s) && d.flagged_room)
    return {
      text: `${d.flagged_room} cooled in a way the normal model could not explain${d.multiplier ? `: the best fit needs about ${d.multiplier.toFixed(1)}× its usual heat loss` : ""}. The heat map shows it losing heat first.`,
      actions: [{ type: "focus_room", target: String(ctx.flagged_room_id ?? "") }, { type: "set_view", target: "thermal" }],
    };
  if (/sure|confiden|certain|trust/.test(s) && d.status)
    return {
      text:
        d.status === "confident"
          ? `Confident. ${d.leading_cause} beats ${d.runner_up} by a fit-score gap of ${d.bic_gap?.toFixed(0)} (above ~10 is a strong preference). It is still a screening result on a simulated twin, not a certified audit.`
          : d.status === "ambiguous"
            ? `Not yet. ${d.leading_cause} and ${d.runner_up} explain the night almost equally well (gap ${d.bic_gap?.toFixed(0)}), so HeatHunter recommends the fan test before suggesting a repair.`
            : `The engine reports "${d.status}". It will not force an answer when the evidence is weak.`,
      actions: [],
    };
  if (/cost|money|save|worth|pay/.test(s) && d.annual_cost)
    return {
      text: `The extra heat loss costs about ${d.annual_cost} a year at the stated gas price${d.payback_years ? `, so the repair pays back in roughly ${d.payback_years.toFixed(0)} years` : ""}. These are screening estimates; adjust the price and repair cost sliders to match your quotes.`,
      actions: [],
    };
  return {
    text: "I can explain what the heat map shows, why a room was flagged, how sure the engine is, or what a fix is worth. Add a GEMINI_API_KEY on the server for free-form answers.",
    actions: [],
  };
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { context, suggestions } = useChatContext();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = [...msgs, { role: "user" as const, content: q.trim() }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    try {
      const reply = await traced("chat", "POST /assistant/chat", () =>
        api.POST("/api/assistant/chat", {
          body: { messages: history.slice(-12).map(({ role, content }) => ({ role, content })), context },
        }),
        (r) => r.model,
      );
      setMsgs((m) => [...m, { role: "assistant", content: reply.reply }]);
      applyActions(reply.actions ?? []);
    } catch (err) {
      const fallback = offlineAnswer(q, context);
      const note = err instanceof ApiError && err.status === 503;
      setMsgs((m) => [...m, { role: "assistant", content: fallback.text, offline: note }]);
      applyActions(fallback.actions);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
            className="glass fixed bottom-20 right-5 z-50 flex h-[min(520px,70vh)] w-[min(380px,calc(100vw-40px))] flex-col overflow-hidden rounded-3xl"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Sparkles size={15} className="text-warm" />
              <div className="text-sm font-semibold">Ask HeatHunter</div>
              <span className="ml-1 text-[11px] text-dim">sees only what's on screen</span>
              <button onClick={() => setOpen(false)} className="ml-auto text-mute hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
              {!msgs.length && <div className="text-mute">Ask anything about what you're looking at. The answer can move the 3D view too.</div>}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "ml-8 rounded-2xl rounded-br-md bg-[#1f2433] px-3 py-2" : "mr-4 text-[#d9dce3]"}>
                  {m.content}
                  {m.offline && <div className="mt-1 text-[10.5px] text-dim">offline answer · built from the engine output on screen</div>}
                </div>
              ))}
              {busy && <div className="text-mute pulse-dot">thinking…</div>}
              <div ref={end} />
            </div>
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {suggestions.slice(0, 3).map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-mute hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              className="flex items-center gap-2 border-t border-line px-3 py-2.5"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Why the hall? Is it worth fixing?"
                className="flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-dim"
              />
              <button className="grid h-8 w-8 place-items-center rounded-full bg-ink text-black disabled:opacity-40" disabled={!input.trim() || busy} aria-label="Send">
                <Send size={14} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium"
      >
        <MessageCircle size={16} className="text-warm" /> Ask HeatHunter
      </button>
    </>
  );
}
