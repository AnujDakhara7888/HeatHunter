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
  /** Home on screen; the server builds the assistant's context for it (public data only). */
  homeId: string | null;
  setContext: (c: Record<string, unknown>, suggestions?: string[]) => void;
  setHome: (homeId: string | null) => void;
}>((set) => ({
  context: {},
  suggestions: [],
  homeId: null,
  setContext: (context, suggestions) => set((s) => ({ context, suggestions: suggestions ?? s.suggestions })),
  setHome: (homeId) => set({ homeId }),
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

/** Grounded fallback when the assistant is unavailable: answers only from what is on screen. */
function offlineAnswer(q: string, ctx: Record<string, unknown>): { text: string; actions: ChatAction[] } {
  const s = q.toLowerCase();
  const d = ctx as {
    rooms?: string[];
    nights?: number;
    selected_room?: { name: string; headline: string; why: string[]; what_to_do: string[]; money?: { annual_cost_gbp: number; repair_cost_gbp: number | null; payback_years: number | null } | null };
  };
  const room = d.selected_room;
  if (/several|nights|why.*night|one night/.test(s))
    return {
      text: "One cold night shows that a room cools too fast, but not why. An air leak gets worse on windy nights and a weak wall does not, so watching nights with different weather tells them apart. A room is only flagged after two nights in a row.",
      actions: [],
    };
  if (/draft|leak|insulat|differ/.test(s))
    return {
      text: "A leak lets cold outside air in, so its effect grows with wind. Weak insulation lets heat soak out through the wall whatever the wind. HeatHunter compares both explanations against every night it has seen.",
      actions: [{ type: "set_view", target: "thermal" }],
    };
  if (/worth|cost|money|save|pay/.test(s) && room?.money)
    return {
      text: `${room.name}: about £${Math.round(room.money.annual_cost_gbp)} a year of extra heating${room.money.repair_cost_gbp != null ? `; a typical repair is about £${Math.round(room.money.repair_cost_gbp)}` : ""}${room.money.payback_years != null ? `, paying back in roughly ${room.money.payback_years.toFixed(1)} years` : ""}. These are screening estimates, not quotes.`,
      actions: [],
    };
  if (/which|where|problem|why/.test(s) && room)
    return { text: `${room.headline} ${room.why.slice(0, 2).join(" ")}`, actions: [{ type: "set_view", target: "thermal" }] };
  if (/do|fix|repair/.test(s) && room?.what_to_do.length) return { text: room.what_to_do.join(" "), actions: [] };
  if (d.rooms?.length) return { text: `After ${d.nights ?? 0} night(s): ${d.rooms.join(" · ")}`, actions: [] };
  return {
    text: "I can explain what the heat map shows, which room is losing heat and why, and what a fix is worth. Add an ANTHROPIC_API_KEY on the server for free-form answers.",
    actions: [],
  };
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { context, suggestions, homeId } = useChatContext();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = [...msgs, { role: "user" as const, content: q.trim() }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    try {
      if (!homeId) throw new ApiError("no home on screen", 503);
      const reply = await traced("chat", "POST /homes/{id}/assistant", () =>
        api.POST("/api/homes/{home_id}/assistant", {
          params: { path: { home_id: homeId } },
          body: { messages: history.slice(-12).map(({ role, content }) => ({ role, content })) },
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
