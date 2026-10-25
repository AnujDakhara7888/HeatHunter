import { useEffect, useState } from "react";
import type { ScenarioCreateRequest } from "../lib/api";
import { ChallengeDialog } from "./ChallengeDialog";
import { ChatWidget } from "./ChatWidget";
import { setChatContext } from "./chatContext";
import { CheckHome } from "./CheckHome";
import { RealWeek } from "./RealWeek";
import { Intake, Landing, PickHome } from "./Screens";

type Screen = "home" | "intake" | "pick" | "check" | "real";

function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5" aria-label="HeatHunter home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="9" fill="url(#lg)" />
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fb923c" />
            <stop offset="1" stopColor="#dc2626" />
          </linearGradient>
        </defs>
        <path d="M8 17 16 9.5 24 17v7H8z" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx="16" cy="19.5" r="2.4" fill="#fff" />
      </svg>
      <span className="text-[19px] font-semibold tracking-tight text-white">HeatHunter</span>
    </button>
  );
}

export default function ConsumerApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [request, setRequest] = useState<ScenarioCreateRequest | null>(null);
  const [run, setRun] = useState(0);
  const [challenge, setChallenge] = useState(false);

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  const startCheck = (r: ScenarioCreateRequest) => {
    setRequest(r);
    setRun((n) => n + 1);
    go("check");
  };

  useEffect(() => {
    document.title = "HeatHunter — find where your home is losing heat";
  }, []);
  useEffect(() => {
    const where: Record<Screen, string> = {
      home: "The visitor is on the HeatHunter home page.",
      intake: "The visitor is on the 'Tell us about your home' page. Checking their own home is coming soon; for now they can skip to an example home.",
      pick: "The visitor is choosing an example home: a guided walkthrough, or 'Set a challenge' where they hide a problem for HeatHunter to find.",
      check: "The visitor is starting a home check.",
      real: "The visitor is on the 'Real data' page.",
    };
    setChatContext(where[screen]);
  }, [screen]);

  return (
    <div className="min-h-screen bg-[#0b0f14] text-white">
      <header className="sticky top-0 z-30 h-16 border-b border-white/8 bg-[#0b0f14]/85 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1280px] items-center gap-6 px-6">
          <Logo onClick={() => go("home")} />
          {screen === "home" && (
            <nav className="hidden items-center gap-6 text-[14.5px] text-white/60 md:flex">
              <a href="#how" className="hover:text-white" onClick={(e) => (e.preventDefault(), document.getElementById("how")?.scrollIntoView({ behavior: "smooth" }))}>
                How it works
              </a>
              <a href="#example" className="hover:text-white" onClick={(e) => (e.preventDefault(), document.getElementById("example")?.scrollIntoView({ behavior: "smooth" }))}>
                The example home
              </a>
              <button className="hover:text-white" onClick={() => go("real")}>
                Real data
              </button>
            </nav>
          )}
          <div className="ml-auto">
            {screen !== "check" && screen !== "real" && (
              <button className="rounded-xl bg-white px-4 py-2 text-[14px] font-semibold text-black hover:bg-white/90" onClick={() => go("intake")}>
                Check my home
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        {screen === "home" && <Landing onCheck={() => go("intake")} onExample={() => go("pick")} onRealWeek={() => go("real")} />}
        {screen === "real" && <RealWeek onBack={() => go("home")} onCheck={() => go("pick")} />}
        {screen === "intake" && <Intake onSkip={() => go("pick")} onBack={() => go("home")} />}
        {screen === "pick" && <PickHome onPick={startCheck} onChallenge={() => setChallenge(true)} onBack={() => go("intake")} />}
        {screen === "check" && request && (
          <CheckHome key={run} request={request} onBack={() => go("pick")} onNew={startCheck} onChallenge={() => setChallenge(true)} />
        )}
      </main>

      {screen !== "check" && screen !== "real" && (
        <footer className="border-t border-white/8">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-8 text-[13px] text-white/40">
            <span>HeatHunter · a student project. Example homes are simulations based on real research data; results are estimates, not a professional energy assessment.</span>
            <a href="#/lab" className="text-white/30 hover:text-white/60">
              Researcher view
            </a>
          </div>
        </footer>
      )}

      <ChatWidget />

      {challenge && (
        <ChallengeDialog
          onClose={() => setChallenge(false)}
          onStart={(r) => {
            setChallenge(false);
            startCheck(r);
          }}
        />
      )}
    </div>
  );
}
