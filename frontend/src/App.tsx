import { BookOpenText, Building2, FlaskConical } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { FaultLab } from "./features/faultlab/FaultLab";
import { RealHomes } from "./features/realhomes/RealHomes";
import { api } from "./lib/api";
import { nowUtc } from "./lib/format";

type Tab = "fault-lab" | "real-homes";

function readTab(): Tab {
  return window.location.hash === "#real-homes" ? "real-homes" : "fault-lab";
}

function useHealth() {
  const [state, setState] = useState<"checking" | "online" | "offline">("checking");
  useEffect(() => {
    let live = true;
    const check = () =>
      api
        .health()
        .then(() => live && setState("online"))
        .catch(() => live && setState("offline"));
    check();
    const id = window.setInterval(check, 15000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
  return state;
}

function useClock() {
  const [time, setTime] = useState(nowUtc());
  useEffect(() => {
    const id = window.setInterval(() => setTime(nowUtc()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="6" fill="#0a1016" stroke="#1b7d93" />
        <path d="M8 17 16 9l8 8v7H8z" fill="none" stroke="#22d3ee" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx="16" cy="19" r="2.6" fill="#f2a516" />
        <circle cx="16" cy="19" r="5.5" fill="none" stroke="#f2a516" strokeOpacity="0.35" />
      </svg>
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-[0.02em] text-ink">
          Heat<span className="text-accent">Hunter</span>
        </div>
        <div className="mt-1 font-mono text-[8.5px] tracking-[0.22em] text-ink-4">THERMAL DIAGNOSTICS</div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const health = useHealth();
  const clock = useClock();
  const onMode = useCallback((label: string | null) => setMode(label), []);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: Tab) => {
    window.location.hash = next;
    setTab(next);
  };

  const tabs: { id: Tab; label: string; icon: typeof FlaskConical; badge: string }[] = [
    { id: "fault-lab", label: "Fault Lab", icon: FlaskConical, badge: "SIMULATED" },
    { id: "real-homes", label: "Real Homes", icon: Building2, badge: "REAL DATA" },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-[#06080c]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 lg:px-6">
          <Logo />
          <nav className="flex items-center gap-1" aria-label="Main">
            {tabs.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => go(id)}
                aria-current={tab === id ? "page" : undefined}
                className={`relative flex h-9 items-center gap-2 rounded px-3 text-[12.5px] transition ${
                  tab === id ? "bg-raised text-ink" : "text-ink-3 hover:bg-raised/60 hover:text-ink"
                }`}
              >
                <Icon size={14} className={tab === id ? "text-accent" : ""} />
                {label}
                <span
                  className={`hidden rounded-[2px] px-1 font-mono text-[8.5px] tracking-[0.14em] sm:inline ${
                    id === "real-homes" ? "bg-ok/10 text-ok" : "bg-accent/10 text-accent"
                  }`}
                >
                  {badge}
                </span>
                {tab === id && <span className="absolute inset-x-2 -bottom-[11px] h-[2px] bg-accent" />}
              </button>
            ))}
          </nav>
          <div className="hidden items-center gap-2 rounded border border-line bg-sunken px-2.5 py-1 md:flex">
            <span className="micro">Reference house</span>
            <span className="text-[12px] font-medium text-ink">SMETER HH09</span>
            <span className="text-[11px] text-ink-4">· detached bungalow · England</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {tab === "fault-lab" && (
              <span className="hidden font-mono text-[10px] tracking-[0.12em] text-ink-3 lg:inline">
                MODE <span className="text-ink">{mode ?? "IDLE"}</span>
              </span>
            )}
            <button className="btn h-8" onClick={() => setDrawer(true)}>
              <BookOpenText size={13} /> Evidence
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-4 lg:px-6">
        {/* Both tabs stay mounted so an investigation survives a tab switch. */}
        <div hidden={tab !== "fault-lab"}>
          <FaultLab onMode={onMode} />
        </div>
        {tab === "real-homes" && <RealHomes />}
      </div>

      <footer className="z-20 sm:sticky sm:bottom-0 border-t border-line bg-[#06080c]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 font-mono text-[9.5px] tracking-[0.12em] text-ink-4 lg:px-6">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${health === "online" ? "bg-ok shadow-[0_0_6px_var(--color-ok)]" : health === "offline" ? "bg-crit" : "bg-ink-4"}`}
            />
            API {health.toUpperCase()}
          </span>
          <span className="hidden sm:inline">OFFLINE-CAPABLE · NO LIVE DATA FEEDS</span>
          <span className="hidden md:inline">
            {tab === "fault-lab" ? "APPROXIMATE HH09 DIGITAL TWIN · SYNTHETIC OBSERVATIONS" : "REAL HH09 MEASUREMENTS · SMETER PHASE 2"}
          </span>
          <span className="ml-auto hidden lg:inline">PRELIMINARY DIAGNOSTIC CONCEPT · NOT A CERTIFIED ENERGY AUDIT</span>
          <span className="ml-auto text-ink-3 lg:ml-0">{clock}Z</span>
        </div>
      </footer>

      <EvidenceDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}
