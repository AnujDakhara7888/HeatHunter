import { Loader2, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import { getChatContext } from "./chatContext";

type Turn = { role: "user" | "assistant"; content: string };

const MAX_CHARS = 600; // matches the server limit
const STARTERS = [
  "How does HeatHunter work?",
  "What's the difference between a draft and poor insulation?",
  "Why would a room be flagged?",
  "How is the yearly cost worked out?",
];

function friendlyError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 429 || err.status === 503 || err.status === 422) return err.message;
    if (err.status === 0) return "I can't reach HeatHunter right now. Please check your connection.";
  }
  return "Something went wrong. Please try again.";
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, error]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (question.length > MAX_CHARS) {
      setError(`Please keep questions under ${MAX_CHARS} characters.`);
      return;
    }
    const next: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);
    try {
      const res = await api.chat({ messages: next, page_context: getChatContext() });
      setTurns([...next, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(friendlyError(err));
      // Drop the unanswered question so the conversation keeps alternating.
      setTurns(turns);
      setDraft(question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-b from-orange-400 to-orange-600 px-5 py-3.5 text-[15px] font-semibold text-white shadow-xl shadow-orange-950/40 transition hover:from-orange-300"
          aria-label="Ask HeatHunter"
        >
          <MessageCircle size={19} /> Ask HeatHunter
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="HeatHunter assistant"
          className="fixed bottom-5 right-5 z-40 flex h-[min(620px,calc(100vh-110px))] w-[min(400px,calc(100vw-40px))] flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#121821] shadow-2xl shadow-black/60"
        >
          <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-400/15 text-orange-300">
              <Sparkles size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-white">HeatHunter assistant</div>
              <div className="text-[12px] text-white/45">AI · answers questions about HeatHunter only</div>
            </div>
            {turns.length > 0 && (
              <button className="rounded-lg p-1.5 text-white/45 hover:bg-white/5 hover:text-white" onClick={() => (setTurns([]), setError(null))} aria-label="Start a new chat" title="New chat">
                <RotateCcw size={16} />
              </button>
            )}
            <button className="rounded-lg p-1.5 text-white/45 hover:bg-white/5 hover:text-white" onClick={() => setOpen(false)} aria-label="Close chat">
              <X size={18} />
            </button>
          </header>

          <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-2xl rounded-tl-md bg-white/[0.06] px-3.5 py-2.5 text-[14px] leading-relaxed text-white/85">
                  Hi! Ask me anything about HeatHunter, how the home check works, or the results on your screen.
                </div>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-white/12 px-3 py-1.5 text-left text-[13px] text-white/75 hover:border-orange-400/50 hover:text-white">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap px-3.5 py-2.5 text-[14px] leading-relaxed ${
                    t.role === "user" ? "rounded-2xl rounded-tr-md bg-orange-500 text-white" : "rounded-2xl rounded-tl-md bg-white/[0.06] text-white/85"
                  }`}
                >
                  {t.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-white/50">
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
            {error && <div className="rounded-2xl border border-red-400/30 bg-red-400/10 px-3.5 py-2.5 text-[13.5px] text-red-100">{error}</div>}
          </div>

          <form
            className="border-t border-white/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                rows={1}
                value={draft}
                maxLength={MAX_CHARS}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder="Ask about your home check…"
                className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 focus:border-orange-400/60 focus:outline-none"
                aria-label="Your question"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-40" aria-label="Send">
                <Send size={17} />
              </button>
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[11px] text-white/35">
              <span>AI can make mistakes. Not professional advice.</span>
              <span>
                {draft.length}/{MAX_CHARS}
              </span>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
