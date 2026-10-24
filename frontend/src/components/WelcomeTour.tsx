import { ArrowRight, Building2, EyeOff, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRegisterModal } from "../lib/modal";

const SLIDES = [
  {
    icon: Building2,
    title: "A real home inspired this one",
    body: "Our virtual house is modelled on a real English bungalow from a UK research study (SMETER house HH09). Its room sizes and windows come from the published floor plan.",
  },
  {
    icon: EyeOff,
    title: "A problem is hidden inside",
    body: "We secretly plant a draft or poor insulation in one room — or nothing at all. HeatHunter can't see what we planted, just like a real investigator.",
  },
  {
    icon: Search,
    title: "HeatHunter investigates",
    body: "It measures how fast each room cools on a cold night, works out the most likely cause, suggests a test when it's unsure, estimates the cost, and checks whether the fix works.",
  },
];

const KEY = "heathunter-welcomed-v1";

export function shouldShowWelcome(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  useRegisterModal();
  const close = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: show again next time */
    }
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const slide = SLIDES[i];
  const Icon = slide.icon;
  const last = i === SLIDES.length - 1;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-b from-[#141d28] to-[#0d1219] p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-white" onClick={close} aria-label="Skip tour">
          <X size={16} />
        </button>
        <div key={i} className="animate-fade-up">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
            <Icon size={26} />
          </span>
          <div className="mt-5 text-[12px] font-medium uppercase tracking-wider text-accent/80">
            Step {i + 1} of {SLIDES.length}
          </div>
          <h2 id="welcome-title" className="mt-1 text-[22px] font-semibold leading-snug text-white">
            {slide.title}
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{slide.body}</p>
        </div>
        <div className="mt-7 flex items-center justify-between">
          <div className="flex gap-1.5">
            {SLIDES.map((_, j) => (
              <span key={j} className={`h-1.5 rounded-full transition-all ${j === i ? "w-6 bg-accent" : "w-1.5 bg-white/20"}`} />
            ))}
          </div>
          <button
            className="flex h-11 items-center gap-2 rounded-xl bg-gradient-to-b from-[#1aa6c4] to-[#0e7d96] px-5 text-[14.5px] font-semibold text-white"
            onClick={() => (last ? close() : setI(i + 1))}
          >
            {last ? "Let's go" : "Next"} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
