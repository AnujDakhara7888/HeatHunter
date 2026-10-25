import { motion } from "framer-motion";
import { ArrowRight, FlaskConical, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, traced } from "../api/client";
import type { RealHouse, Series } from "../api/types";
import { useChatContext } from "../components/ChatDock";
import { Nav } from "../components/Nav";
import { HH09_PLAN, HH09_Z_BEARING } from "../lib/plan";
import { coolingRate, fmtTime, ms, valueAt } from "../lib/rooms";
import { useScene, type View } from "../store/scene";
import { HouseCanvas } from "../three/Scene";
import { toInsulation } from "../three/thermal";

const NIGHT: [string, string] = ["2021-02-18T22:00:00Z", "2021-02-19T06:00:00Z"];

function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

type Chapter = {
  view: View;
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  finding?: boolean;
  fan?: boolean;
  scrub?: boolean;
  align?: "left" | "right";
};

const CHAPTERS: Chapter[] = [
  {
    view: "open",
    eyebrow: "A real house · SMETER HH09, England",
    title: (
      <>
        Heating off at 22:00.
        <br />
        <span className="text-mute">Scroll through the night.</span>
      </>
    ),
    body: "Every colour on the floor is a real sensor reading from this bungalow, 18 February 2021.",
    scrub: true,
  },
  {
    view: "thermal",
    eyebrow: "The question",
    title: (
      <>
        Is one room leaking?
        <br />
        <span className="text-mute">And through what?</span>
      </>
    ),
    body: "In the Fault Lab we hide a fault inside a digital twin of this house. Here: weak insulation in the hall.",
    finding: true,
    align: "right",
  },
  {
    view: "open",
    eyebrow: "The method",
    title: (
      <>
        Three suspects.
        <br />
        <span className="text-mute">Physics questions each one.</span>
      </>
    ),
    body: "Normal, an air leak, or weak insulation. Every night, each is fitted to how every room actually cooled.",
    finding: true,
  },
  {
    view: "exterior",
    eyebrow: "Night after night",
    title: (
      <>
        One night can't tell.
        <br />
        <span className="text-mute">The wind can.</span>
      </>
    ),
    body: "A leak gets worse on windy nights; a weak wall doesn't. Watching nights with different weather tells them apart, so a room is flagged only after two nights in a row.",
    finding: true,
    align: "right",
  },
  {
    view: "inside",
    eyebrow: "The proof",
    title: (
      <>
        Fix it yourself.
        <br />
        <span className="text-mute">We confirm it worked.</span>
      </>
    ),
    body: "Tell the app what you did. It judges only the nights after your repair, and says plainly whether the problem is gone.",
    finding: true,
  },
];

export default function Landing() {
  const set = useScene((s) => s.set);
  const [house, setHouse] = useState<RealHouse | null>(null);
  const [chapter, setChapter] = useState(-1);
  const [clock, setClock] = useState<number | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    set({ plan: HH09_PLAN, view: "exterior", autoRotate: true, finding: null, focusRoom: null, fanOn: false, labels: true, inset: 0, names: {}, ir: false, zBearing: HH09_Z_BEARING, windFrom: null });
    traced("real", "GET /real/house", () => api.GET("/api/real/house"), (h) => `${Object.keys(h.room_temperature_series).length} real sensors`)
      .then(setHouse)
      .catch(() => null);
    useChatContext.getState().setContext(
      { page: "Landing: what HeatHunter does", house: "SMETER HH09, a real detached bungalow in England" },
      ["What does HeatHunter do?", "Leak vs insulation?", "Can I use my own home?"],
    );
  }, [set]);

  const night = useMemo(() => {
    if (!house) return null;
    const [a, b] = NIGHT.map(ms);
    const rooms = Object.fromEntries(Object.entries(house.room_temperature_series).map(([k, s]) => [k, slice(s, a, b)]));
    return { a, b, rooms, outdoor: slice(house.outdoor_temperature, a, b), wind: slice(house.wind_speed, a, b) };
  }, [house]);

  useEffect(() => {
    if (!night) return;
    const values = Object.values(night.rooms).flatMap((s) => s.values).filter((v): v is number => v != null);
    const out = night.outdoor.values.filter((v): v is number => v != null);
    set({
      tempRange: [Math.min(...values) - 0.5, Math.max(...values) + 0.5],
      outdoorRange: out.length ? [Math.min(...out), Math.max(...out)] : null,
      insulation: house?.insulation ? toInsulation(house.insulation) : null,
      rates: Object.fromEntries(Object.entries(night.rooms).map(([k, s]) => [k, coolingRate(s)])),
    });
  }, [night, house, set]);

  // Scroll drives the camera chapter and, in chapter 1, the clock.
  useEffect(() => {
    const onScroll = () => {
      const mid = window.innerHeight * 0.55;
      let active = -1;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top < mid && r.bottom > mid) active = i;
      });
      setChapter(active);
      if (night) {
        const first = refs.current[0];
        let k = 1;
        if (first) {
          const r = first.getBoundingClientRect();
          k = Math.min(1, Math.max(0, (window.innerHeight * 0.7 - r.top) / (r.height * 0.95)));
        }
        setClock(night.a + k * (night.b - night.a));
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [night]);

  useEffect(() => {
    if (!night || clock == null) return;
    set({
      temps: Object.fromEntries(Object.entries(night.rooms).map(([k, s]) => [k, valueAt(s, clock)])),
      outdoor: valueAt(night.outdoor, clock),
      wind: valueAt(night.wind, clock),
    });
  }, [clock, night, set]);

  useEffect(() => {
    const c = CHAPTERS[chapter];
    if (!c) {
      set({ view: "exterior", autoRotate: chapter < 0, finding: null, fanOn: false, focusRoom: null, inset: chapter < 0 ? -520 : 0 });
      return;
    }
    set({
      inset: c.view === "inside" ? 0 : c.align === "right" ? 560 : -560,
      view: c.view,
      autoRotate: false,
      fanOn: !!c.fan,
      focusRoom: c.view === "inside" ? "hall" : null,
      finding: c.finding ? { room: "hall", cause: "envelope_conduction", strength: 0.8, extra: 0.32 } : null, // illustrative
    });
  }, [chapter, set]);

  const outdoor = useScene((s) => s.outdoor);

  return (
    <div className="relative">
      <Nav transparent />
      <HouseCanvas className="fixed inset-0 -z-0" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-r from-[#05070b] via-[#05070b55] to-transparent" style={{ opacity: chapter >= 0 ? 0.85 : 0.6 }} />

      {/* hero */}
      <section className="relative flex min-h-screen items-center px-[6vw]">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} className="max-w-[640px]">
          <h1 className="text-[clamp(52px,8vw,104px)] font-bold leading-[0.95] tracking-[-0.045em]">
            See where your heat <span className="grad-text">escapes.</span>
          </h1>
          <p className="mt-6 max-w-md text-[20px] leading-snug text-mute">Cheap sensors. A few cold nights. Physics finds the room that leaks, and why.</p>
          <div className="pointer-events-auto mt-9 flex flex-wrap gap-3">
            <Link to="/lab" className="btn btn-primary !px-6 !py-3 !text-[15px]">
              Find the hidden fault <ArrowRight size={16} />
            </Link>
            <Link to="/home" className="btn btn-ghost !px-6 !py-3 !text-[15px]">
              <Upload size={16} /> Bring your home
            </Link>
          </div>
          <div className="mt-16 flex gap-10 text-[12px] text-mute">
            <div>
              <div className="text-[28px] font-bold text-ink">HH09</div>real UK bungalow
            </div>
            <div>
              <div className="text-[28px] font-bold text-ink">3</div>suspects tested
            </div>
          </div>
        </motion.div>
        <motion.div animate={{ y: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[12px] text-dim">
          scroll ↓
        </motion.div>
      </section>

      {CHAPTERS.map((c, i) => (
        <section
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`relative flex items-center px-[6vw] ${c.scrub ? "min-h-[200vh] items-start" : "min-h-[115vh]"} ${c.align === "right" ? "justify-end" : ""}`}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ amount: 0.6, once: false }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className={`max-w-[520px] ${c.scrub ? "sticky top-[30vh]" : ""}`}
          >
            <div className="eyebrow">{c.eyebrow}</div>
            <h2 className="mt-3 text-[clamp(38px,5vw,64px)] font-bold leading-[1.0] tracking-[-0.035em]">{c.title}</h2>
            {c.body && <p className="mt-5 max-w-sm text-[17px] leading-snug text-mute">{c.body}</p>}
            {c.scrub && clock != null && (
              <div className="glass mt-6 inline-flex items-center gap-4 rounded-2xl px-4 py-3">
                <div className="num text-[30px] font-bold tracking-tight">{fmtTime(clock)}</div>
                <div className="text-[12px] leading-tight text-mute">
                  outside
                  <br />
                  <b className="num text-[15px] text-ink">{outdoor == null ? "–" : `${outdoor.toFixed(1)}°C`}</b>
                </div>
              </div>
            )}
          </motion.div>
        </section>
      ))}

      <section className="relative flex min-h-screen flex-col justify-center px-[6vw]">
        <h2 className="max-w-3xl text-[clamp(40px,5.5vw,72px)] font-bold leading-[1] tracking-[-0.04em]">
          Pick a home. Watch it cool. <span className="text-mute">Catch the leak.</span>
        </h2>
        <div className="pointer-events-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
          {[
            { to: "/lab", icon: <FlaskConical size={20} />, t: "Fault Lab", d: "Plant a fault in a simulated house, or let a judge plant it. Advance night by night and watch it get caught." },
            { to: "/home", icon: <Upload size={20} />, t: "Your home", d: "Upload a floor plan and your sensor logs. HeatHunter watches your rooms night after night." },
          ].map((c) => (
            <Link key={c.t} to={c.to} className="glass group rounded-3xl p-6 transition hover:-translate-y-1">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-white/10">{c.icon}</div>
              <div className="mt-4 text-xl font-semibold">{c.t}</div>
              <p className="mt-2 text-[14px] leading-snug text-mute">{c.d}</p>
              <div className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-ink/80 group-hover:text-ink">
                Open <ArrowRight size={14} />
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-14 max-w-2xl text-[12px] leading-relaxed text-dim">
          HH09 data: Allinson et al. (2024), Technical Evaluation of SMETER Technologies Phase 2, UK Data Service SN 856978. The Fault Lab uses an
          approximate digital twin with synthetic faults; we make no claim that the real HH09 has a fault. A preliminary screening concept, not a
          certified energy audit.
        </p>
      </section>
    </div>
  );
}
