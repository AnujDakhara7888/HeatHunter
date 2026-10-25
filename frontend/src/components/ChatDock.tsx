import { AnimatePresence, motion, useDragControls, useMotionValue } from "framer-motion";
import { GripVertical, Maximize2, MessageCircle, Minus, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { ApiError, api, traced } from "../api/client";
import type { AssistantScreen, ChatAction } from "../api/types";
import { useScene, type View } from "../store/scene";

type Msg = { role: "user" | "assistant"; content: string; offline?: boolean; notice?: string };

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
    text: "I can explain what the heat map shows, which room is losing heat and why, and what a fix is worth. Free-form AI chat is unavailable right now; this is an offline explanation.",
    actions: [],
  };
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const dragControls = useDragControls();
  const dragBounds = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const keepOnScreen = useCallback(() => {
    if (!dragBounds.current || !panel.current) return;
    const maxX = Math.max(0, dragBounds.current.clientWidth - panel.current.offsetWidth);
    const maxY = Math.max(0, dragBounds.current.clientHeight - panel.current.offsetHeight);
    x.set(positioned.current ? Math.min(maxX, Math.max(0, x.get())) : Math.max(0, maxX - 8));
    y.set(positioned.current ? Math.min(maxY, Math.max(0, y.get())) : Math.max(0, maxY - 68));
    positioned.current = true;
  }, [x, y]);
  useLayoutEffect(() => {
    if (!open) return;
    keepOnScreen();
    window.addEventListener("resize", keepOnScreen);
    return () => window.removeEventListener("resize", keepOnScreen);
  }, [open, minimized, keepOnScreen]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { context, suggestions, homeId: storedHomeId } = useChatContext();
  const { pathname } = useLocation();
  const page: AssistantScreen["page"] = pathname === "/lab" ? "fault_lab" : pathname === "/home" ? "your_home" : "overview";
  const homeId = page === "fault_lab" || page === "your_home" ? storedHomeId : null;
  const view = useScene((s) => s.view);
  const infrared = useScene((s) => s.ir);
  const focusRoom = useScene((s) => s.focusRoom);
  const scope = `${page}:${homeId ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);
  const requestEpoch = useRef(0);
  useEffect(() => {
    requestEpoch.current += 1;
    setMsgs([]);
    setInput("");
    setBusy(false);
  }, [scope]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = [...msgs, { role: "user" as const, content: q.trim() }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    const epoch = ++requestEpoch.current;
    const selected = focusRoom ?? (typeof context.selected_room_id === "string" ? context.selected_room_id : null);
    const selectedRoom = page === "fault_lab" && selected ? ({ bedroom: "bedroom_1", hall: "bedroom_2" } as Record<string, string>)[selected] ?? selected : selected;
    const window = context.visible_window as { start: string; end: string } | undefined;
    const screen: AssistantScreen = {
      page, view, infrared, selected_room_id: selectedRoom,
      ...(window ? { window_start: window.start, window_end: window.end } : {}),
      ...(page === "your_home" ? { step: context.step as AssistantScreen["step"] } : {}),
    };
    const body = { messages: history.slice(-12).map(({ role, content }) => ({ role, content })), screen };
    try {
      const reply = await traced("chat", homeId ? "POST /homes/{id}/assistant" : "POST /assistant/help", () =>
        homeId
          ? api.POST("/api/homes/{home_id}/assistant", { params: { path: { home_id: homeId } }, body })
          : api.POST("/api/assistant/help", { body }),
        (r) => r.model,
      );
      if (epoch !== requestEpoch.current || currentScope.current !== scope) return;
      setMsgs((m) => [...m, { role: "assistant", content: reply.reply }]);
      applyActions(reply.actions ?? []);
    } catch (err) {
      if (epoch !== requestEpoch.current || currentScope.current !== scope) return;
      if (err instanceof ApiError && err.status === 404) {
        setMsgs((m) => [...m, { role: "assistant", content: "This demo session has expired. Start a new demo to ask about its rooms.", notice: "Session unavailable" }]);
        return;
      }
      const fallback = offlineAnswer(q, context);
      // Say why the AI was unavailable (the server's reason never contains the key).
      const reason = err instanceof ApiError && err.code === "ASSISTANT_UNAVAILABLE" ? err.message : null;
      setMsgs((m) => [...m, { role: "assistant", content: fallback.text, offline: true, ...(reason ? { notice: `Offline explanation · ${reason}` } : {}) }]);
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  };

  return (
    <>
      <div ref={dragBounds} className="pointer-events-none fixed inset-3 z-[70]">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panel}
            role="dialog"
            aria-label="HeatHunter assistant"
            aria-modal={false}
            style={{ x, y }}
            drag
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={dragBounds}
            dragElastic={0}
            dragMomentum={false}
            onDragEnd={keepOnScreen}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
            className={`glass pointer-events-auto absolute left-0 top-0 flex w-[min(380px,calc(100vw-40px))] flex-col overflow-hidden rounded-3xl ${minimized ? "h-auto" : "h-[min(520px,70dvh,calc(100dvh-40px))]"}`}
          >
            <div className={`flex shrink-0 items-center gap-1 px-3 py-2.5 ${minimized ? "" : "border-b border-line"}`}>
              <div
                role="button"
                tabIndex={0}
                aria-label="Move chat window"
                title="Drag to move · arrow keys also move the chat"
                className="flex min-w-0 flex-1 cursor-grab touch-none select-none items-center gap-2 rounded-lg py-1 outline-none focus-visible:ring-1 focus-visible:ring-warm active:cursor-grabbing"
                onPointerDown={(event) => dragControls.start(event)}
                onKeyDown={(event) => {
                  const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
                  if (!delta) return;
                  event.preventDefault();
                  x.set(x.get() + delta[0]);
                  y.set(y.get() + delta[1]);
                  keepOnScreen();
                }}
              >
                <GripVertical size={13} className="shrink-0 text-dim" />
                <Sparkles size={15} className="shrink-0 text-warm" />
                <div className="truncate text-sm font-semibold">Ask HeatHunter</div>
                {!minimized && <span className="truncate text-[11px] text-dim">{({ overview: "Overview", fault_lab: "Fault Lab", real_home: "Real home", your_home: "Your home" })[page]}</span>}
                {minimized && busy && <span className="pulse-dot text-[11px] text-dim">thinking…</span>}
              </div>
              <button onClick={() => setMinimized((value) => !value)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-mute hover:bg-white/5 hover:text-ink" aria-label={minimized ? "Restore chat" : "Minimize chat"} title={minimized ? "Restore chat" : "Minimize chat"}>
                {minimized ? <Maximize2 size={14} /> : <Minus size={16} />}
              </button>
              <button onClick={() => setOpen(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-mute hover:bg-white/5 hover:text-ink" aria-label="Close" title="Close chat">
                <X size={16} />
              </button>
            </div>
            <div className={minimized ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
              {!msgs.length && <div className="text-mute">Ask anything about what you're looking at. The answer can move the 3D view too.</div>}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "ml-8 rounded-2xl rounded-br-md bg-[#1f2433] px-3 py-2" : "mr-4 text-[#d9dce3]"}>
                  {m.content}
                  {m.role === "assistant" && <div className="mt-1 text-[10.5px] text-dim">{m.notice ?? (m.offline ? "Offline explanation · AI connection unavailable" : "AI reply")}</div>}
                </div>
              ))}
              {busy && <div className="text-mute pulse-dot">thinking…</div>}
              <div ref={end} />
            </div>
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {["Explain this screen", ...(homeId ? suggestions : ["How do I start?", "Can I connect sensors?"])].slice(0, 3).map((s) => (
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      <button
        onClick={() => {
          if (open && minimized) setMinimized(false);
          else {
            setMinimized(false);
            setOpen((value) => !value);
          }
        }}
        className="glass fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium"
      >
        <MessageCircle size={16} className="text-warm" /> Ask HeatHunter
      </button>
    </>
  );
}
