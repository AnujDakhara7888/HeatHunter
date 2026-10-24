import { ArrowRight, Check, ClipboardList, EyeOff, FileUp, Flame, Home, Lock, Moon, Search, Wind } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { api, FLOOR_PLAN_URL, type RealHouse, type ScenarioCreateRequest } from "../lib/api";
import { GUIDED_FULL_ID } from "../lib/demo";
import { fmt } from "../lib/format";

const RealisticHouse = lazy(() => import("./RealisticHouse"));

export const GUIDED: ScenarioCreateRequest = { mode: "guided", guided_scenario_id: GUIDED_FULL_ID };

function Primary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-orange-400 to-orange-600 px-7 py-3.5 text-[16px] font-semibold text-white shadow-lg shadow-orange-900/30 transition hover:from-orange-300 hover:to-orange-500">
      {children}
    </button>
  );
}
function Secondary({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[16px] font-medium text-white transition hover:bg-white/10">
      {children}
    </button>
  );
}

const noop = () => undefined;

/**
 * Optional hero photo, picked up at build time: add any licensed house photo as
 * frontend/src/assets/hero-house.(jpg|jpeg|png|webp). Without one, the 3D house is shown.
 */
const HERO_PHOTOS = import.meta.glob("../assets/hero-house.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const HERO_PHOTO: string | null = Object.values(HERO_PHOTOS)[0] ?? null;

/** Photo with an animated thermal-camera sweep: an inverted "ironbow" colour map, so a bright sky reads cold and dark windows read warm. */
function PhotoHero({ src }: { src: string }) {
  return (
    <div className="absolute inset-0">
      <svg className="absolute h-0 w-0" aria-hidden>
        <filter id="ironbow" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="1 1 1 0.78 0.35 0.03" />
            <feFuncG type="table" tableValues="1 0.88 0.48 0.08 0 0" />
            <feFuncB type="table" tableValues="0.85 0.15 0.02 0.32 0.55 0.18" />
          </feComponentTransfer>
        </filter>
      </svg>
      <img src={src} alt="A family home" className="absolute inset-0 h-full w-full object-cover" />
      <div className="thermal-sweep absolute inset-0">
        <img src={src} alt="" aria-hidden className="h-full w-full object-cover" style={{ filter: "url(#ironbow) contrast(1.15)" }} />
      </div>
      <div className="thermal-line pointer-events-none absolute inset-y-0 w-[3px] bg-cyan-300 shadow-[0_0_24px_6px_rgba(103,232,249,0.65)]" />
    </div>
  );
}

function HeroHouse() {
  return (
    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-3xl bg-white/5" />}>
      <RealisticHouse
        phase="day"
        roofOpen={false}
        heatView={false}
        readings={{}}
        thermal={[10, 21]}
        showLabels={false}
        problemRoom={null}
        problem={null}
        fixedRoom={null}
        truthRoom={null}
        fanOn={false}
        selected={null}
        onSelect={noop}
        autoRotate
        view="outside"
        viewNonce={0}
        height="100%"
      />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ landing */

export function Landing({ onCheck, onExample }: { onCheck: () => void; onExample: () => void }) {
  const [house, setHouse] = useState<RealHouse | null>(null);
  const photo = HERO_PHOTO !== null;
  useEffect(() => {
    api.realHouse().then(setHouse).catch(() => setHouse(null));
  }, []);
  const area = house?.characteristics.find((c) => c.name === "total_floor_area")?.value;
  const type = house?.characteristics.find((c) => c.name === "dwelling_type")?.value;
  const attach = house?.characteristics.find((c) => c.name === "attachment")?.value;

  return (
    <div>
      <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-6 pb-16 pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-16">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-[13px] text-orange-200">
            <Flame size={14} /> A check-engine light for your home
          </div>
          <h1 className="mt-5 text-[42px] font-semibold leading-[1.05] tracking-tight text-white sm:text-[56px]">
            Find out where your home is <span className="bg-gradient-to-r from-orange-300 to-red-400 bg-clip-text text-transparent">losing heat.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-white/65">
            HeatHunter watches how each room cools overnight, works out what's wrong — a draft or poor insulation — and tells you what fixing it could save.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Primary onClick={onCheck}>
              Check my home <ArrowRight size={18} />
            </Primary>
            <Secondary onClick={onExample}>Try an example home</Secondary>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/50">
            <span className="flex items-center gap-1.5">
              <Check size={15} className="text-emerald-400" /> Room-by-room
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={15} className="text-emerald-400" /> Plain-English results
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={15} className="text-emerald-400" /> Honest when unsure
            </span>
          </div>
        </div>
        <div className="relative h-[420px] overflow-hidden rounded-[28px] border border-white/10 shadow-2xl shadow-black/50 sm:h-[540px]">
          {HERO_PHOTO ? <PhotoHero src={HERO_PHOTO} /> : <HeroHouse />}
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-black/45 px-3 py-1.5 text-[12.5px] text-white/80 backdrop-blur">
            {photo ? "Illustrative photo · thermal-camera effect" : "Drag to look around"}
          </div>
        </div>
      </section>

      <section id="how" className="border-y border-white/8 bg-white/[0.02]">
        <div className="mx-auto max-w-[1280px] px-6 py-16">
          <h2 className="text-[30px] font-semibold tracking-tight text-white">How it works</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              { icon: ClipboardList, title: "1. Tell us about your home", body: "Your floor plan and a few details — or skip and try one of our example homes." },
              { icon: Moon, title: "2. The overnight test", body: "With the heating off, we track how fast each room cools. A room that loses heat too quickly stands out." },
              { icon: Search, title: "3. The problem, the cost, the fix", body: "We work out the likely cause, what it's costing you, and check whether the fix actually works." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-[#121821] p-6">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-400/15 text-orange-300">
                  <Icon size={22} />
                </span>
                <h3 className="mt-4 text-[18px] font-semibold text-white">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/60">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-6 py-16">
        <h2 className="text-[30px] font-semibold tracking-tight text-white">What we look for</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl border border-sky-400/20 bg-sky-400/[0.05] p-6">
            <Wind size={26} className="text-sky-300" />
            <h3 className="mt-3 text-[19px] font-semibold text-white">Drafts</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-white/60">Cold air sneaking in through gaps around windows, doors and floors. Usually cheap to fix with draught-proofing.</p>
          </div>
          <div className="rounded-3xl border border-orange-400/20 bg-orange-400/[0.05] p-6">
            <Flame size={26} className="text-orange-300" />
            <h3 className="mt-3 text-[19px] font-semibold text-white">Poor insulation</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-white/60">Heat soaking out through walls, ceilings or floors. Fixed by adding insulation where it's missing.</p>
          </div>
        </div>
        <p className="mt-5 text-[15px] text-white/50">
          And when the evidence can't tell them apart, HeatHunter says so — and suggests a simple test — rather than guessing.
        </p>
      </section>

      <section id="example" className="border-t border-white/8 bg-white/[0.02]">
        <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-6 py-16 lg:grid-cols-2">
          <div>
            <h2 className="text-[30px] font-semibold tracking-tight text-white">Meet the example home</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-white/60">
              Our example is based on a real home measured by university researchers in a UK research study. We built a virtual copy of it, then
              hide problems inside the copy for HeatHunter to find. Nothing is claimed about the real house itself.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              {[
                ["Type", type && attach ? `${attach} ${String(type).toLowerCase()}` : "—"],
                ["Floor area", typeof area === "number" ? `${fmt(area, 0)} m²` : "—"],
                ["Where", "England"],
                ["Measured heat loss", house?.reference_htc ? `${fmt(house.reference_htc.value, 0)} watts per °C` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-[#121821] px-4 py-3">
                  <dt className="text-[13px] text-white/50">{k}</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold text-white">{v}</dd>
                </div>
              ))}
            </dl>
            {house?.reference_htc && (
              <p className="mt-4 text-[14px] leading-relaxed text-white/50">
                "Measured heat loss" means the whole house loses about {fmt(house.reference_htc.value, 0)} watts for every 1°C it's colder outside than
                inside — measured by researchers with a heating test.
              </p>
            )}
            <p className="mt-3 text-[12.5px] text-white/35">Data: SMETER Phase 2 study, published by the UK Data Service.</p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white p-3 shadow-xl">
            <img src={FLOOR_PLAN_URL} alt="Floor plan of the example home" className="aspect-[1240/1220] w-full object-cover object-top" />
            <div className="px-2 pb-1 pt-2 text-[12.5px] text-neutral-500">The real floor plan, as published by the researchers.</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-6 py-16 text-center">
        <h2 className="text-[30px] font-semibold tracking-tight text-white">Ready to see it in action?</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Primary onClick={onCheck}>
            Check my home <ArrowRight size={18} />
          </Primary>
          <Secondary onClick={onExample}>Try an example home</Secondary>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- intake */

export function Intake({ onSkip, onBack }: { onSkip: () => void; onBack: () => void }) {
  const field = "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[15px] text-white/50";
  return (
    <div className="mx-auto max-w-[760px] px-6 py-12">
      <button className="text-[14px] text-white/50 hover:text-white" onClick={onBack}>
        ← Back
      </button>
      <h1 className="mt-4 text-[34px] font-semibold tracking-tight text-white">Tell us about your home</h1>
      <p className="mt-2 text-[16px] text-white/60">The more we know, the better HeatHunter can tell what's normal for your home.</p>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-orange-400/30 bg-orange-400/[0.08] px-5 py-4">
        <Lock size={19} className="mt-0.5 shrink-0 text-orange-300" />
        <div>
          <div className="text-[15.5px] font-semibold text-white">Checking your own home is coming soon</div>
          <p className="mt-1 text-[14.5px] leading-relaxed text-white/65">
            For now, you can explore one of our example homes — it's already set up with everything HeatHunter needs.
          </p>
          <div className="mt-4">
            <Primary onClick={onSkip}>
              Skip — use an example home <ArrowRight size={18} />
            </Primary>
          </div>
        </div>
      </div>

      <fieldset disabled className="mt-8 space-y-5 rounded-3xl border border-white/10 bg-[#121821] p-6 opacity-60" aria-describedby="intake-soon">
        <legend id="intake-soon" className="sr-only">
          Coming soon
        </legend>
        <div className="grid place-items-center rounded-2xl border-2 border-dashed border-white/15 px-6 py-10 text-center">
          <FileUp size={30} className="text-white/40" />
          <div className="mt-3 text-[16px] font-medium text-white/70">Upload your floor plan</div>
          <div className="mt-1 text-[13.5px] text-white/40">PDF or photo · coming soon</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[14px] text-white/70">
            Type of home
            <select className={field}>
              <option>Bungalow</option>
            </select>
          </label>
          <label className="text-[14px] text-white/70">
            Number of rooms
            <input className={field} placeholder="e.g. 4" />
          </label>
          <label className="text-[14px] text-white/70">
            How is it heated?
            <select className={field}>
              <option>Gas boiler</option>
            </select>
          </label>
          <label className="text-[14px] text-white/70">
            Postcode or ZIP
            <input className={field} placeholder="For local weather" />
          </label>
        </div>
      </fieldset>
    </div>
  );
}

/* --------------------------------------------------------------------- pick */

function HouseIcon({ tone }: { tone: string }) {
  return (
    <svg viewBox="0 0 120 80" className="h-20 w-full" aria-hidden>
      <rect x="0" y="62" width="120" height="18" rx="4" fill="#2f4a2a" />
      <path d="M22 40 L60 14 L98 40 Z" fill="#3a3f45" />
      <rect x="28" y="38" width="64" height="26" fill="#a5523a" />
      <rect x="36" y="44" width="14" height="10" fill={tone} opacity="0.9" />
      <rect x="70" y="44" width="14" height="10" fill={tone} opacity="0.9" />
      <rect x="55" y="48" width="10" height="16" fill="#5a3a24" />
      <rect x="74" y="20" width="7" height="14" fill="#8a4a35" />
    </svg>
  );
}

export function PickHome({ onPick, onChallenge, onBack }: { onPick: (r: ScenarioCreateRequest) => void; onChallenge: () => void; onBack: () => void }) {
  const cards = [
    {
      title: "Guided example",
      badge: "Start here",
      body: "A step-by-step walkthrough of a full check — the overnight test, the diagnosis, a fan test, the fix and the answer.",
      icon: Home,
      tone: "#ffd59a",
      action: () => onPick(GUIDED),
      cta: "Start the walkthrough",
    },
    {
      title: "Set a challenge",
      body: "You choose the problem and the room. We keep it secret from HeatHunter.",
      icon: EyeOff,
      tone: "#c4b5fd",
      action: onChallenge,
      cta: "Hide a problem",
    },
  ];
  return (
    <div className="mx-auto max-w-[920px] px-6 py-12">
      <button className="text-[14px] text-white/50 hover:text-white" onClick={onBack}>
        ← Back
      </button>
      <h1 className="mt-4 text-[34px] font-semibold tracking-tight text-white">Choose an example home</h1>
      <p className="mt-2 max-w-2xl text-[16px] text-white/60">
        Both use a virtual copy of a real bungalow in England with a hidden problem for HeatHunter to find.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {cards.map((c) => (
          <button
            key={c.title}
            onClick={c.action}
            className="group flex flex-col rounded-3xl border border-white/10 bg-[#121821] p-6 text-left transition hover:-translate-y-0.5 hover:border-orange-400/50 hover:shadow-xl hover:shadow-orange-950/30"
          >
            <div className="rounded-2xl bg-gradient-to-b from-[#2a4466] to-[#152233] px-4 pt-4">
              <HouseIcon tone={c.tone} />
            </div>
            <div className="mt-5 flex items-center gap-2">
              <h3 className="text-[19px] font-semibold text-white">{c.title}</h3>
              {c.badge && <span className="rounded-full bg-orange-400/20 px-2 py-0.5 text-[12px] font-semibold text-orange-200">{c.badge}</span>}
            </div>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed text-white/60">{c.body}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-semibold text-orange-300 group-hover:text-orange-200">
              {c.cta} <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
