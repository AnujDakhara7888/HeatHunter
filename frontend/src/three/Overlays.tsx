import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { useEffect } from "react";
import { displayName } from "../lib/rooms";
import { useScene } from "../store/scene";

const FLIR_GRADIENT = "linear-gradient(0deg,#05063f,#0d26bf,#008cf2,#1abf59,#f2e61a,#ff8c0d,#e61a1a,#ffbfcc)";

/** Walk-in navigation: hop between rooms with the arrows, chips or keyboard. */
export function RoomHopper() {
  const view = useScene((s) => s.view);
  const plan = useScene((s) => s.plan);
  const focus = useScene((s) => s.focusRoom);
  const finding = useScene((s) => s.finding);
  const names = useScene((s) => s.names);
  const inset = useScene((s) => s.inset);
  const temps = useScene((s) => s.temps);
  const set = useScene((s) => s.set);
  const rooms = plan.rooms.filter((r) => r.width * r.depth > 1.5);
  const current = focus ?? finding?.room ?? rooms[0]?.room_id;
  const idx = Math.max(0, rooms.findIndex((r) => r.room_id === current));
  const go = (d: number) => set({ focusRoom: rooms[(idx + d + rooms.length) % rooms.length].room_id });

  useEffect(() => {
    if (view !== "inside") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") set({ view: "open" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const center = { left: `calc(50% - ${Math.max(0, inset) / 2}px)` };
  return (
    <AnimatePresence>
      {view === "inside" ? (
        <motion.div
          key="hopper"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="glass absolute top-[118px] z-20 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 text-[12.5px]"
          style={center}
        >
          <button onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Previous room">
            <ChevronLeft size={16} />
          </button>
          {rooms.map((r) => (
            <button
              key={r.room_id}
              onClick={() => set({ focusRoom: r.room_id })}
              className={`rounded-full px-3 py-1.5 ${r.room_id === current ? "bg-ink font-semibold text-black" : "text-mute hover:text-ink"}`}
            >
              {displayName(r.room_id, names)}
              {r.room_id === current && temps[r.room_id] != null && <span className="num ml-1.5">{temps[r.room_id]!.toFixed(1)}°</span>}
              {finding?.room === r.room_id && <span className="ml-1 text-hot">●</span>}
            </button>
          ))}
          <button onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Next room">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => set({ view: "open" })} className="ml-1 grid h-8 w-8 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-ink" aria-label="Step outside">
            <LogOut size={15} />
          </button>
        </motion.div>
      ) : null}
      {view === "inside" && (
        <motion.div
          key="walkpad"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute bottom-6 z-20 flex flex-col items-center gap-1.5"
          style={{ right: `${Math.max(0, inset) + 28}px` }}
        >
          <WalkKey k="ArrowUp" label="▲" />
          <div className="flex gap-1.5">
            <WalkKey k="ArrowLeft" label="↺" />
            <WalkKey k="ArrowDown" label="▼" />
            <WalkKey k="ArrowRight" label="↻" />
          </div>
          <div className="glass mt-1 rounded-full px-3 py-1 text-[10.5px] text-mute">W A S D / arrows · drag to look · scroll to step · double-click floor to go there</div>
        </motion.div>
      )}
      {view !== "inside" && (
        (view === "open" || view === "fan" || view === "top") && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-[118px] z-10 -translate-x-1/2 text-[11.5px] text-dim"
            style={center}
          >
            Double-click a room to walk in
          </motion.div>
        )
      )}
    </AnimatePresence>
  );
}

/**
 * FLIR-style heads-up display for the infrared view. Only measured numbers are
 * printed (room air and outdoor temperatures); the colours render those measured
 * temperatures and the engine's finding, which the label says plainly.
 */
export function ThermalHud() {
  const view = useScene((s) => s.view);
  const ir = useScene((s) => s.ir);
  const temps = useScene((s) => s.temps);
  const outdoor = useScene((s) => s.outdoor);
  const focus = useScene((s) => s.focusRoom);
  const finding = useScene((s) => s.finding);
  const names = useScene((s) => s.names);
  const inset = useScene((s) => s.inset);
  const spot = useScene((s) => s.spot);
  const thermal = view === "thermal" || ir;
  const inside = view === "inside";
  // What the crosshair is on; before the first ray lands, the room in focus.
  const room = spot ? spot.room : (focus ?? finding?.room ?? null);
  const air = room ? temps[room] : null;
  const known = Object.values(temps).filter((v): v is number => v != null);
  const warm = known.length ? Math.max(...known) : null;
  const coldLabel = inside ? (finding?.room === room && finding?.cause ? (finding.cause === "draft" ? "cold air at openings" : "cold wall") : "glass") : "outside air";
  return (
    <AnimatePresence>
      {thermal && (
        <motion.div key="hud" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-10 font-mono text-white">
          <div className="absolute left-4 top-16 rounded-md bg-black/35 px-2.5 py-1.5 text-[11px] leading-snug">
            <div className="font-semibold tracking-wider">◈ IR VIEW</div>
            <div className="text-white/70">rendered from measured room temperatures and the engine's finding, not a camera image</div>
          </div>
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `calc(50% - ${Math.max(0, inset) / 2}px)` }}>
            <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow">
              <line x1="0" x2="45" y1="60" y2="60" stroke="white" strokeWidth="1.5" />
              <line x1="75" x2="120" y1="60" y2="60" stroke="white" strokeWidth="1.5" />
              <line y1="0" y2="45" x1="60" x2="60" stroke="white" strokeWidth="1.5" />
              <line y1="75" y2="120" x1="60" x2="60" stroke="white" strokeWidth="1.5" />
              <rect x="52" y="52" width="16" height="16" transform="rotate(45 60 60)" fill="none" stroke="white" strokeWidth="1.5" />
            </svg>
            <div className="absolute left-[78px] top-[70px] whitespace-nowrap text-[13px] drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
              {room ? (
                <>
                  {displayName(room, names)} air {air == null ? "–" : `${air.toFixed(1)} °C`}
                  <div className="text-[10.5px] text-white/75">{air == null ? "no sensor in this room" : "measured sensor"}</div>
                </>
              ) : (
                <>
                  Outside air {outdoor == null ? "–" : `${outdoor.toFixed(1)} °C`}
                  <div className="text-[10.5px] text-white/75">weather station</div>
                </>
              )}
            </div>
          </div>
          <div className="absolute bottom-[140px] flex items-stretch gap-2 text-[11px]" style={{ right: `${Math.max(0, inset) + 20}px` }}>
            <div className="flex flex-col justify-between py-0.5 text-right drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
              <span>{inside ? "warm wall" : "heat escaping"}{warm != null && inside ? ` · ${warm.toFixed(1)}°` : ""}</span>
              <span>
                {coldLabel}
                {outdoor != null && !inside ? ` · ${outdoor.toFixed(1)}°` : ""}
              </span>
            </div>
            <div className="h-44 w-3 rounded-full ring-1 ring-white/40" style={{ background: FLIR_GRADIENT }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** On-screen walk button: holds the matching key down while pressed. */
function WalkKey({ k, label }: { k: string; label: string }) {
  const send = (type: "keydown" | "keyup") => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
  return (
    <button
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        send("keydown");
      }}
      onPointerUp={() => send("keyup")}
      onPointerCancel={() => send("keyup")}
      className="glass grid h-10 w-10 select-none place-items-center rounded-xl text-[14px] text-ink active:bg-white/20"
      aria-label={k}
    >
      {label}
    </button>
  );
}
