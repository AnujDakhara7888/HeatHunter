import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Cpu, Eye, Fan, Flag, MessageCircle, Search, Sparkles, Wrench } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HomeHistory, HomeReadings, RoomHistory, RoomNightSnapshot, RoomReport, RoomStatus, RoomTechnical, Series } from "../api/types";
import { ROOM_STATUS, causeLabel } from "../lib/diagnosis";
import { bicWeights, milestones, shortDate, snapAt, statusStrip } from "../lib/history";
import { CAUSE, SIM_TO_PLAN, ms, roomColor, type CauseKey } from "../lib/rooms";
import { LineChart } from "./LineChart";
import { NightsChart } from "./NightsChart";

type Props = {
  label: string;
  history: HomeHistory;
  readings: HomeReadings;
  asOf: number;
  setAsOf: (n: number) => void;
  room: string | null;
  setRoom: (id: string) => void;
  /** the room's current report and math, used only when looking at the latest night */
  report: RoomReport | null;
  technical: RoomTechnical | null;
  onClose: () => void;
  /** API room id -> the plan room id the 3D house and room colours use (the HH09 twin maps bedroom_1 -> bedroom). */
  planRoom?: (id: string) => string;
};

const RoomColor = createContext<(id: string) => string>((id) => roomColor(SIM_TO_PLAN[id] ?? id));

const gbp = (v: number) => `£${v < 100 ? v.toFixed(0) : Math.round(v).toLocaleString()}`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
const FLAGGED: RoomStatus[] = ["issue", "issue_cause_unclear", "still_an_issue"];
const WINDY = 4;
const FAN_COLOR = "#2fc6d9";
/** Night numbers (1-based, up to n) that were fan-test nights. */
const fanNights = (history: HomeHistory, n: number) =>
  history.nights.slice(0, n).flatMap((x, i) => (x.kind === "fan_test" ? [i + 1] : []));

function slice(s: Series, a: number, b: number): Series {
  const idx = s.timestamps.map((t, i) => [ms(t), i] as const).filter(([t]) => t >= a && t <= b).map(([, i]) => i);
  return { ...s, timestamps: idx.map((i) => s.timestamps[i]), values: idx.map((i) => s.values[i]) };
}

/** Two layers over a home's analysis as of one night: the story, then the engine underneath. */
export function Analytics({ label, history, readings, asOf, setAsOf, room, setRoom, report, technical, onClose, planRoom }: Props) {
  const [layer, setLayer] = useState<"story" | "tech">("story");
  const page = useRef<HTMLDivElement>(null);
  const switchLayer = (k: "story" | "tech") => {
    setLayer(k);
    page.current?.scrollTo({ top: 0 });
  };
  const total = history.nights.length;
  const n = Math.min(Math.max(1, asOf), total);
  const latest = n === total;
  const rooms = history.rooms;
  const focus = rooms.find((r) => r.room_id === room) ?? rooms.find((r) => FLAGGED.includes(snapAt(r, n)?.status ?? "healthy")) ?? rooms[0];
  const night = history.nights[n - 1];
  const colorOf = (id: string) => roomColor(planRoom ? planRoom(id) : SIM_TO_PLAN[id] ?? id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && n > 1) setAsOf(n - 1);
      if (e.key === "ArrowRight" && n < total) setAsOf(n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, total, onClose, setAsOf]);

  return (
    <RoomColor.Provider value={colorOf}>
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} ref={page} className="fixed inset-0 z-[60] overflow-y-auto bg-[#05070bf5] backdrop-blur-xl scroll-thin">
      {/* top bar */}
      <div className="sticky top-0 z-20 border-b border-line bg-[#05070bd9] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <button onClick={onClose} className="btn btn-ghost !px-3 !py-1.5 !text-[13px]">
            <ArrowLeft size={14} /> House
          </button>
          <div className="min-w-0">
            <div className="eyebrow truncate">{label}</div>
            <div className="text-[15px] font-semibold">Analytics</div>
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-full border border-line p-1">
            {(
              [
                ["story", "What happened", <Sparkles key="s" size={13} />],
                ["tech", "Under the hood", <Cpu key="c" size={13} />],
              ] as const
            ).map(([k, l, icon]) => (
              <button key={k} onClick={() => switchLayer(k)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ${layer === k ? "bg-ink font-semibold text-black" : "text-mute hover:text-ink"}`}>
                {icon} {l}
              </button>
            ))}
          </div>
        </div>
        {/* time + room */}
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-full p-1 text-mute hover:bg-white/10 hover:text-ink disabled:opacity-30" disabled={n <= 1} onClick={() => setAsOf(n - 1)} aria-label="Previous night">
              <ChevronLeft size={16} />
            </button>
            <div className="w-[150px]">
              <div className="text-[11px] text-mute">As of</div>
              <div className="num text-[14px] font-semibold">
                Night {n} <span className="font-normal text-mute">· {shortDate(night.start)}</span>
              </div>
            </div>
            <button className="rounded-full p-1 text-mute hover:bg-white/10 hover:text-ink disabled:opacity-30" disabled={n >= total} onClick={() => setAsOf(n + 1)} aria-label="Next night">
              <ChevronRight size={16} />
            </button>
            <input type="range" min={1} max={total} value={n} onChange={(e) => setAsOf(Number(e.target.value))} className="w-[min(220px,40vw)]" aria-label="Analysis as of night" />
            {!latest && (
              <button onClick={() => setAsOf(total)} className="text-[11.5px] text-warm underline">
                back to today
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rooms.map((r) => {
              const s = snapAt(r, n)?.status ?? "not_enough_data";
              return (
                <button key={r.room_id} onClick={() => setRoom(r.room_id)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${focus.room_id === r.room_id ? "border-white/50 bg-white/10 text-ink" : "border-line text-mute hover:text-ink"}`}>
                  <i className="h-2 w-2 rounded-full" style={{ background: colorOf(r.room_id) }} />
                  {r.name}
                  <span style={{ color: ROOM_STATUS[s].color }} aria-label={ROOM_STATUS[s].label}>
                    {ROOM_STATUS[s].icon}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-6 sm:px-6">
        {!latest && (
          <div className="mb-5 rounded-2xl border border-warm/30 bg-warm/10 px-4 py-2.5 text-[12.5px] text-warm">
            Looking back: this is only what the app knew after night {n}. Nights {n + 1}–{total} are hidden.
          </div>
        )}
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-[13px] text-mute">
          <MessageCircle size={15} className="mt-0.5 shrink-0 text-warm" />
          <span>
            {layer === "story" ? "What happened to this room, in plain words." : "The engine's working behind the verdict: its fits, scores and rules."} Not sure what something means?{" "}
            <b className="text-ink">Ask HeatHunter</b> (bottom right): the AI assistant can explain any number or chart on this page.
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={layer + focus.room_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {layer === "story" ? (
              <Story history={history} room={focus} n={n} setAsOf={setAsOf} setRoom={setRoom} report={latest ? report : null} />
            ) : (
              <Tech history={history} readings={readings} room={focus} n={n} setAsOf={setAsOf} report={latest ? report : null} technical={latest ? technical : null} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
    </RoomColor.Provider>
  );
}

// ---------------------------------------------------------------- layer 1

function Section({ title, kicker, children, right }: { title: string; kicker?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          {kicker && <div className="eyebrow">{kicker}</div>}
          <h3 className="text-[22px] font-bold tracking-tight">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function headline(name: string, s: RoomNightSnapshot | null): { big: string; sub: string | null } {
  const status = s?.status ?? "not_enough_data";
  const cause = s?.named_cause ? (s.named_cause === "draft" ? "Most likely air leaks (draughts)." : "Most likely the walls, roof or floor.") : null;
  switch (status) {
    case "not_enough_data":
      return { big: `${name}: waiting for its first night.`, sub: null };
    case "healthy":
      return { big: `${name} cools like a healthy room.`, sub: null };
    case "watching":
      return { big: `${name} cooled faster than it should.`, sub: "One night isn't proof. Watching the next one." };
    case "issue":
      return { big: `${name} is losing heat it shouldn't.`, sub: cause };
    case "issue_cause_unclear":
      return { big: `${name} is losing extra heat.`, sub: "Leak or walls? Too close to call yet. Windy nights, or a fan test, will split them." };
    case "verifying":
      return { big: `Checking your repair in the ${name.toLowerCase()}.`, sub: `${s?.nights_judged ?? 0} night${s?.nights_judged === 1 ? "" : "s"} since the fix.` };
    case "resolved":
      return { big: `${name}: fixed.`, sub: "Since the repair it cools the way it should." };
    case "still_an_issue":
      return { big: `${name}: the repair didn't work.`, sub: cause ?? "It's still losing extra heat." };
  }
}

/** Ordinary nights above the alarm in a row; fan-test nights never count toward an alarm. */
function streakAt(room: RoomHistory, n: number, history: HomeHistory) {
  const shots = room.snapshots.filter((s) => s.night_number <= n && history.nights[s.night_number - 1]?.kind !== "fan_test");
  let k = 0;
  for (let i = shots.length - 1; i >= 0 && shots[i].candidate; i--) k++;
  return k;
}

function Story({ history, room, n, setAsOf, setRoom, report }: { history: HomeHistory; room: RoomHistory; n: number; setAsOf: (n: number) => void; setRoom: (id: string) => void; report: RoomReport | null }) {
  const snap = snapAt(room, n);
  const h = headline(room.name, snap);
  const m = milestones(room, n);
  const streak = streakAt(room, n, history);
  const nights = history.nights.slice(0, n);
  const strip = statusStrip(room, n);
  const status = snap?.status ?? "not_enough_data";
  const flagged = FLAGGED.includes(status) || status === "watching";
  const weights = snap ? bicWeights(snap.fits) : {};
  const color = useContext(RoomColor)(room.room_id);
  const advice = snap?.named_cause ? history.advice[snap.named_cause] : status === "issue_cause_unclear" ? [history.advice.draft[0], history.advice.envelope_conduction[0]] : [];
  const costs = strip.map((s) => s.snap?.annual_cost_gbp ?? null);

  return (
    <div>
      {/* hero */}
      <div className="relative overflow-hidden rounded-[30px] border border-line p-6 sm:p-8" style={{ background: `radial-gradient(120% 140% at 0% 0%, ${ROOM_STATUS[status].color}26, transparent 55%), #0b0e15` }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: ROOM_STATUS[status].color, background: `${ROOM_STATUS[status].color}22` }}>
            {ROOM_STATUS[status].icon} {ROOM_STATUS[status].label}
          </span>
          <span className="text-[12px] text-mute">
            {n} night{n === 1 ? "" : "s"} watched · {shortDate(history.nights[0].start)} – {shortDate(history.nights[n - 1].start)}
          </span>
        </div>
        <h2 className="mt-3 max-w-[820px] text-[clamp(28px,4.4vw,46px)] font-bold leading-[1.04] tracking-[-0.03em]">{h.big}</h2>
        {h.sub && <p className="mt-2 text-[17px] text-mute">{h.sub}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Extra heat loss" value={snap ? pct(Math.max(0, snap.extra_heat_loss_percent)) : "–"} sub={snap ? `alarm at ${Math.round(snap.threshold_percent)}%` : "no night yet"} tone={snap && snap.extra_heat_loss_percent > snap.threshold_percent ? "hot" : undefined} />
          <Tile label="Costing you" value={snap?.annual_cost_gbp != null ? `${gbp(snap.annual_cost_gbp)}` : "£0"} sub={snap?.annual_cost_gbp != null ? "per year if left" : "nothing flagged"} tone={snap?.annual_cost_gbp ? "hot" : "ok"} />
          <Tile label="Nights above alarm" value={`${streak}`} sub={`in a row · ${history.persistence_nights} needed to flag`} />
          <Tile label="First sign" value={m.firstSign ? `Night ${m.firstSign.night_number}` : "None"} sub={m.firstSign ? shortDate(history.nights[m.firstSign.night_number - 1].start) : "every night normal"} />
        </div>
      </div>

      {/* story rail */}
      <Section kicker="The story" title="How it unfolded">
        <StoryRail history={history} room={room} n={n} setAsOf={setAsOf} />
      </Section>

      {/* house overview */}
      <Section kicker="Whole house" title="Every room, every night" right={<span className="hidden text-[11.5px] text-dim sm:block">Click a square to jump there</span>}>
        <Swimlane history={history} n={n} focus={room.room_id} setAsOf={setAsOf} setRoom={setRoom} />
      </Section>

      {/* trend */}
      <Section kicker={room.name} title={flagged ? "Is it getting worse?" : "How close to the alarm?"}>
        <div className="rounded-3xl border border-line bg-white/[0.02] p-4 sm:p-5">
          <NightsChart
            nights={n}
            height={230}
            unit="%"
            format={(v) => `${Math.round(v)}`}
            overFill="#ff6a3d"
            current={n}
            onPick={setAsOf}
            series={[
              { id: "x", label: "Extra heat loss", color, values: strip.map((s) => (s.snap ? Math.max(0, s.snap.extra_heat_loss_percent) : null)) },
              { id: "t", label: "Alarm level", color: "#f2f3f5", dashed: true, values: strip.map((s) => s.snap?.threshold_percent ?? null) },
            ]}
            marks={[
              ...(m.flagged ? [{ night: m.flagged.night_number, label: "flagged", color: "#ff6a3d" }] : []),
              ...(m.fixAt ? [{ night: m.fixAt.night_number, label: "after fix", color: "#7aa8ff" }] : []),
              ...fanNights(history, n).map((k) => ({ night: k, label: "fan test", color: FAN_COLOR })),
            ]}
            tooltipExtra={(k) => <div className="mt-1 text-mute">wind {nights[k - 1]?.mean_wind_m_s.toFixed(1)} m/s · {nights[k - 1]?.mean_outdoor_c.toFixed(1)}°C</div>}
          />
          <div className="mt-1 text-[11px] text-mute">Wind each night (m/s) · windy nights in blue</div>
          <NightsChart nights={n} height={80} legend={false} current={n} onPick={setAsOf} format={(v) => v.toFixed(0)} series={[{ id: "w", label: "Wind", color: "#4a5162", kind: "bar", values: nights.map((x) => x.mean_wind_m_s), barColors: nights.map((x) => (x.mean_wind_m_s >= WINDY ? "#3987e5" : null)) }]} />
          <p className="mt-3 text-[13px] text-mute">
            Extra heat loss is how much faster than a healthy room it loses heat (0% = as expected). The alarm starts high and drops as nights add up, so one odd
            night can't trigger it but a steady pattern does. An air leak has a lower alarm than weak insulation, so the line steps when the leading suspect
            changes. Shaded = above the alarm.
          </p>
        </div>
      </Section>

      {/* suspects */}
      <Section kicker="The suspects" title="Who explains these nights best?">
        {snap ? (
          <Suspects snap={snap} weights={weights} gapRule={history.cause_gap_bic} strip={strip} showLead={strip.some((s) => s.snap?.candidate)} fans={fanNights(history, n)} />
        ) : (
          <Empty>No nights scored yet.</Empty>
        )}
      </Section>

      {/* money */}
      {costs.some((c) => c != null) && (
        <Section kicker="Money" title="What it's costing">
          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Lost per year" value={snap?.annual_cost_gbp != null ? gbp(snap.annual_cost_gbp) : "–"} sub={report?.money ? `${Math.round(report.money.annual_energy_kwh)} kWh` : "estimate at this night"} tone="hot" />
              <Tile label="Typical repair" value={report?.money?.repair_cost_gbp != null ? gbp(report.money.repair_cost_gbp) : "–"} sub={report ? "for the named cause" : "shown for today"} />
              <Tile label="Pays for itself" value={report?.money?.payback_years != null ? `${report.money.payback_years.toFixed(1)} yr` : "–"} tone="ok" />
              <Tile label="Over 5 years" value={snap?.annual_cost_gbp != null ? gbp(snap.annual_cost_gbp * 5) : "–"} sub="if nothing changes" tone="hot" />
            </div>
            <div className="rounded-3xl border border-line bg-white/[0.02] p-4">
              <div className="text-[12px] text-mute">Yearly cost estimate after each night</div>
              <NightsChart nights={n} height={150} legend={false} current={n} onPick={setAsOf} format={(v) => `£${Math.round(v)}`} series={[{ id: "c", label: "Estimated cost per year", color: "#ff6a3d", kind: "bar", values: costs }]} />
              <div className="text-[11px] text-dim">The estimate settles as evidence builds. Screening estimate, not a quote.</div>
            </div>
          </div>
        </Section>
      )}

      {/* what to do */}
      {advice.length > 0 && (
        <Section kicker="Next" title="What to do">
          <div className="grid gap-3 md:grid-cols-3">
            {advice.map((a, i) => (
              <div key={a} className="rounded-3xl border border-line bg-white/[0.02] p-4">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-[13px] font-bold">{i + 1}</div>
                <p className="mt-3 text-[14px] leading-snug">{a}</p>
              </div>
            ))}
          </div>
          {report?.suggested_check && <div className="mt-3 rounded-2xl bg-[#16233b] px-4 py-3 text-[13px] text-[#cfe0ff]">{report.suggested_check}</div>}
          <div className="mt-3 flex items-center gap-2 text-[12px] text-mute">
            <Wrench size={13} /> Did the repair? Tell the app from the house panel, then keep watching.
          </div>
        </Section>
      )}

    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "hot" }) {
  return (
    <div className="rounded-2xl border border-line bg-black/20 px-4 py-3">
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className={`num mt-0.5 text-[28px] font-bold leading-tight tracking-tight ${tone === "ok" ? "text-ok" : tone === "hot" ? "text-hot" : ""}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-dim">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-dashed border-line p-6 text-center text-[13px] text-mute">{children}</div>;
}

function StoryRail({ history, room, n, setAsOf }: { history: HomeHistory; room: RoomHistory; n: number; setAsOf: (n: number) => void }) {
  const m = milestones(room, n);
  const date = (s: RoomNightSnapshot) => shortDate(history.nights[s.night_number - 1].start);
  const wind = (s: RoomNightSnapshot) => history.nights[s.night_number - 1].mean_wind_m_s;
  const steps: { at: RoomNightSnapshot; icon: ReactNode; title: string; line: string; color: string }[] = [];
  if (m.firstSign) steps.push({ at: m.firstSign, icon: <Search size={14} />, title: "First sign", line: `Cooled ${pct(m.firstSign.extra_heat_loss_percent)} faster than a healthy room. Wind ${wind(m.firstSign).toFixed(1)} m/s.`, color: "#ffb020" });
  if (m.flagged) steps.push({ at: m.flagged, icon: <Flag size={14} />, title: "Flagged", line: `${history.persistence_nights} nights in a row above the alarm. Not a one-off.`, color: "#ff6a3d" });
  if (m.named) steps.push({ at: m.named, icon: <Sparkles size={14} />, title: `Named: ${causeLabel(m.named.named_cause!).toLowerCase()}`, line: `Clearly beat the other explanation (ΔBIC ${m.named.cause_gap_bic.toFixed(1)} > ${history.cause_gap_bic}).`, color: CAUSE[m.named.named_cause as CauseKey].color });
  if (m.fixAt) steps.push({ at: m.fixAt, icon: <Wrench size={14} />, title: "Repair reported", line: "From here only nights after the fix count.", color: "#7aa8ff" });
  if (m.resolved) steps.push({ at: m.resolved, icon: <Eye size={14} />, title: "Confirmed fixed", line: `${history.persistence_nights} normal nights after the repair.`, color: "#2fd18b" });
  if (m.stillBad) steps.push({ at: m.stillBad, icon: <Flag size={14} />, title: "Repair didn't help", line: "Still above the alarm after the fix.", color: "#ff3b5c" });
  const fan = room.snapshots.find((s) => s.night_number <= n && history.nights[s.night_number - 1]?.kind === "fan_test");
  if (fan)
    steps.push({
      at: fan,
      icon: <Fan size={14} />,
      title: "Fan test",
      line: fan.named_cause
        ? `2 hours of extractor fan pulled in outside air. That settled it: ${causeLabel(fan.named_cause).toLowerCase()}.`
        : "2 hours of extractor fan pulled in outside air, but leak and walls still fit about equally.",
      color: FAN_COLOR,
    });
  steps.sort((x, y) => x.at.night_number - y.at.night_number);

  if (!steps.length)
    return (
      <Empty>
        {room.snapshots.some((s) => s.night_number <= n) ? `Nothing unusual in the ${room.name.toLowerCase()} over ${n} night${n === 1 ? "" : "s"}. That's the story.` : "No nights scored yet."}
      </Empty>
    );
  return (
    <div className="relative">
      <div className="absolute left-[19px] top-4 bottom-4 w-px bg-white/10 md:left-0 md:right-0 md:top-[19px] md:bottom-auto md:h-px md:w-auto" />
      <div className="relative grid gap-4 md:grid-flow-col md:auto-cols-fr">
        {steps.map((s, i) => (
          <motion.button key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }} onClick={() => setAsOf(s.at.night_number)} className="flex gap-3 text-left md:block">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 bg-[#0b0e15]" style={{ borderColor: s.color, color: s.color }}>
              {s.icon}
            </div>
            <div className="md:mt-3">
              <div className="num text-[11.5px] text-mute">
                Night {s.at.night_number} · {date(s.at)}
              </div>
              <div className="text-[15px] font-semibold">{s.title}</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-mute">{s.line}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Swimlane({ history, n, focus, setAsOf, setRoom }: { history: HomeHistory; n: number; focus: string; setAsOf: (n: number) => void; setRoom: (id: string) => void }) {
  const colorOf = useContext(RoomColor);
  const total = history.nights.length;
  const seen = new Set<RoomStatus>();
  return (
    <div className="rounded-3xl border border-line bg-white/[0.02] p-4">
      <div className="scroll-thin overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: "3px" }}>
          <thead>
            <tr>
              <th className="w-28" />
              {history.nights.map((x, i) => (
                <th key={x.night_id} className={`num min-w-6 pb-1 text-center text-[10px] font-normal ${i + 1 > n ? "text-[#2b303b]" : x.mean_wind_m_s >= WINDY ? "text-[#9cc8ff]" : "text-dim"}`} title={`${shortDate(x.start)} · wind ${x.mean_wind_m_s.toFixed(1)} m/s`}>
                  {x.kind === "fan_test" && i + 1 <= n ? <span style={{ color: FAN_COLOR }}>◆</span> : x.mean_wind_m_s >= WINDY && i + 1 <= n ? "≋" : ""}
                  <div>{i + 1}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.rooms.map((r) => (
              <tr key={r.room_id}>
                <td>
                  <button onClick={() => setRoom(r.room_id)} className={`flex items-center gap-1.5 text-left text-[12.5px] ${focus === r.room_id ? "font-semibold text-ink" : "text-mute hover:text-ink"}`}>
                    <i className="h-2 w-2 rounded-full" style={{ background: colorOf(r.room_id) }} />
                    {r.name}
                  </button>
                </td>
                {Array.from({ length: total }, (_, i) => {
                  const k = i + 1;
                  const s = k <= n ? r.snapshots.find((x) => x.night_number === k) : undefined;
                  const st = s?.status;
                  if (st) seen.add(st);
                  const c = st ? ROOM_STATUS[st] : null;
                  return (
                    <td key={k} className="p-0">
                      <button
                        onClick={() => (setAsOf(k), setRoom(r.room_id))}
                        disabled={k > n}
                        title={s ? `Night ${k}: ${c!.label} · ${pct(s.extra_heat_loss_percent)} vs alarm ${Math.round(s.threshold_percent)}%` : k > n ? "Not yet" : "Not scored"}
                        className={`grid h-7 w-7 place-items-center sm:w-8 rounded-[6px] text-[11px] font-bold transition ${k === n && focus === r.room_id ? "ring-2 ring-white/70" : ""}`}
                        style={{ background: c ? `${c.color}${st === "healthy" ? "33" : "cc"}` : k > n ? "#ffffff05" : "#ffffff0d", color: c && st !== "healthy" ? "#0b0e15" : c?.color }}
                      >
                        {c && st !== "healthy" ? c.icon : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
        {[...seen].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: ROOM_STATUS[s].color }} />
            {ROOM_STATUS[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-[#9cc8ff]">≋ windy night</span>
        {history.nights.some((x) => x.kind === "fan_test") && <span className="inline-flex items-center gap-1" style={{ color: FAN_COLOR }}>◆ fan test night</span>}
      </div>
    </div>
  );
}

function Suspects({ snap, weights, gapRule, strip, showLead, fans }: { snap: RoomNightSnapshot; weights: Record<string, number>; gapRule: number; strip: { night: number; snap: RoomNightSnapshot | null }[]; showLead: boolean; fans: number[] }) {
  const order: CauseKey[] = ["draft", "envelope_conduction", "normal"];
  const best = order.reduce((a, b) => ((weights[b] ?? 0) > (weights[a] ?? 0) ? b : a), "normal" as CauseKey);
  const fit = (c: CauseKey) => snap.fits.find((f) => f.fault_type === c);
  const clear = snap.cause_gap_bic > gapRule;
  const blurb: Record<CauseKey, string> = {
    draft: "Cold air pushed in through gaps. Gets worse when it's windy.",
    envelope_conduction: "Heat soaking out through walls, roof or floor. Same on calm and windy nights.",
    normal: "Nothing wrong: the room cools as the model expects.",
  };
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        {order.map((c, i) => {
          const w = weights[c] ?? 0;
          const f = fit(c);
          const lead = c === best;
          return (
            <motion.div key={c} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={`relative rounded-3xl border p-5 ${lead ? "border-white/40 bg-white/[0.06]" : "border-line bg-white/[0.02]"}`}>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
                  <span className="grid h-8 w-8 place-items-center rounded-full text-[15px]" style={{ background: `${CAUSE[c].color}33`, color: CAUSE[c].color }}>
                    {CAUSE[c].icon}
                  </span>
                  {CAUSE[c].label}
                </span>
                {lead ? <span className="rounded-full bg-ink px-2 py-0.5 text-[10.5px] font-bold text-black">BEST FIT</span> : w < 0.05 ? <span className="text-[10.5px] text-dim">ruled out</span> : null}
              </div>
              <div className="num mt-4 text-[38px] font-bold leading-none tracking-tight">{Math.round(w * 100)}%</div>
              <div className="text-[11.5px] text-mute">relative support</div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <motion.div className="h-full rounded-full" style={{ background: CAUSE[c].color }} initial={{ width: 0 }} animate={{ width: `${Math.max(2, w * 100)}%` }} transition={{ duration: 0.8 }} />
              </div>
              <p className="mt-3 text-[13px] leading-snug text-mute">{blurb[c]}</p>
              {f && c !== "normal" && <div className="num mt-2 text-[11.5px] text-dim">fits as ×{f.fitted_multiplier.toFixed(2)} normal heat loss · ±{f.residual_rmse_deg_c.toFixed(2)}°</div>}
            </motion.div>
          );
        })}
      </div>
      {showLead && (
      <div className="mt-4 rounded-2xl border border-line bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold">Leak or walls? Which fault fitted better, night by night</div>
          <div className={`text-[12px] ${clear ? "text-ok" : "text-warm"}`}>{clear ? `Clear lead now (gap ${snap.cause_gap_bic.toFixed(1)} > ${gapRule})` : `Too close to call (gap ${snap.cause_gap_bic.toFixed(1)} ≤ ${gapRule})`}</div>
        </div>
        <div className="mt-2 flex gap-1">
          {strip.map(({ night, snap: s }) => (
            <div key={night} className="flex-1" title={s ? `Night ${night}: ${causeLabel(s.leading_cause)} ahead (gap ${s.cause_gap_bic.toFixed(1)})` : `Night ${night}`}>
              <div className="h-6 rounded-[5px]" style={{ background: s ? CAUSE[s.leading_cause as CauseKey].color : "#ffffff0d", opacity: s ? Math.min(1, 0.3 + s.cause_gap_bic / (gapRule * 2)) : 1 }} />
              <div className="num mt-1 text-center text-[9.5px]" style={{ color: fans.includes(night) ? FAN_COLOR : undefined }}>{fans.includes(night) ? `◆${night}` : night}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-mute">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CAUSE.draft.color }} /> Air leak ahead
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CAUSE.envelope_conduction.color }} /> Weak insulation ahead
          </span>
          <span>faded = narrow lead</span>
          {fans.length > 0 && <span style={{ color: FAN_COLOR }}>◆ fan test night</span>}
        </div>
        {snap.fan_test_nights > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px]" style={{ background: `${FAN_COLOR}14`, color: "#bdeef5" }}>
            <Fan size={14} className="mt-0.5 shrink-0" />
            <span>
              The cause was judged with {snap.fan_test_nights === 1 ? "a fan test" : `${snap.fan_test_nights} fan tests`}: 2 hours of extractor fan pull extra
              outside air in through any gaps, which shows up in a leaky room but not in one with weak walls. Fan nights only help name the cause; they never
              raise an alarm on their own.
            </span>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- layer 2

function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-line bg-white/[0.02] p-4 sm:p-5 ${className}`}>
      <div className="mb-3">
        <div className="text-[15px] font-semibold">{title}</div>
        {sub && <div className="text-[12px] text-mute">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Tech({ history, readings, room, n, setAsOf, report, technical }: { history: HomeHistory; readings: HomeReadings; room: RoomHistory; n: number; setAsOf: (n: number) => void; report: RoomReport | null; technical: RoomTechnical | null }) {
  const info = history.nights[n - 1];
  const rr = readings.rooms[room.room_id];
  const color = useContext(RoomColor)(room.room_id);
  const a = ms(info.start);
  const b = ms(info.end);
  const strip = statusStrip(room, n);
  const snap = snapAt(room, n);
  const weights = snap ? bicWeights(snap.fits) : {};
  const mult = (c: string) => strip.map((s) => s.snap?.fits.find((f) => f.fault_type === c)?.fitted_multiplier ?? null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card title={`Night ${n}: ${room.name} readings vs the healthy-room model`} sub={`${shortDate(info.start)} · heating off · ${info.mean_outdoor_c.toFixed(1)}°C outside · wind ${info.mean_wind_m_s.toFixed(1)} m/s. The model is fitted to this room's own nights, so on any one night the lines sit close.`}>
          {rr ? (
            <LineChart
              height={250}
              data={[
                { id: "m", label: "Measured", color, series: slice(rr.measured, a, b), width: 2.5 },
                ...(rr.expected_if_healthy ? [{ id: "e", label: "Expected if healthy", color: "#2fd18b", series: slice(rr.expected_if_healthy, a, b), dashed: true }] : []),
                { id: "o", label: "Outside", color: "#8a90a2", series: slice(readings.outdoor_temperature, a, b), dashed: true, width: 1.5 },
              ]}
            />
          ) : (
            <Empty>No sensor in this room.</Empty>
          )}
        </Card>
        <Card title={`What the app concluded after night ${n}`} sub="One night alone barely differs from a healthy room. The evidence is in how the fits move across nights, below.">
          {snap ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: ROOM_STATUS[snap.status].color, background: `${ROOM_STATUS[snap.status].color}22` }}>
                  {ROOM_STATUS[snap.status].icon} {ROOM_STATUS[snap.status].label}
                </span>
                <span className="text-[12px] text-mute">{snap.nights_judged} night{snap.nights_judged === 1 ? "" : "s"} judged{snap.after_fix ? " since the fix" : ""}</span>
              </div>
              {[
                ["Extra heat loss", `${snap.extra_heat_loss_percent.toFixed(1)}%`],
                ["Alarm level now", `${snap.threshold_percent.toFixed(1)}%`],
                ["Leading explanation", causeLabel(snap.leading_cause)],
                ["Lead over runner-up", `ΔBIC ${snap.cause_gap_bic.toFixed(1)} (names a cause above ${history.cause_gap_bic})`],
                ["Above the alarm tonight", snap.candidate ? "yes" : "no"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13px]">
                  <span className="text-mute">{k}</span>
                  <span className="num text-right font-medium">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Not scored yet.</Empty>
          )}
        </Card>
      </div>


      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Model fits after each night" sub="How much bigger than normal each kind of heat loss would have to be to match the readings (×1 = healthy).">
          <NightsChart
            nights={n}
            height={210}
            current={n}
            onPick={setAsOf}
            format={(v) => `×${v.toFixed(1)}`}
            ref_={{ value: 1, label: "healthy ×1" }}
            series={[
              { id: "d", label: CAUSE.draft.label, color: CAUSE.draft.color, values: mult("draft") },
              { id: "e", label: CAUSE.envelope_conduction.label, color: CAUSE.envelope_conduction.color, values: mult("envelope_conduction") },
            ]}
          />
        </Card>
        <Card title={`Fits after night ${n}`} sub="Lower BIC = better explanation, after a penalty for extra parameters.">
          {snap ? (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-dim">
                  <th className="pb-2 font-normal">Hypothesis</th>
                  <th className="pb-2 text-right font-normal">Multiplier</th>
                  <th className="pb-2 text-right font-normal">BIC</th>
                  <th className="pb-2 text-right font-normal">RMSE</th>
                  <th className="pb-2 text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody className="num">
                {[...snap.fits].sort((x, y) => x.bic - y.bic).map((f) => (
                  <tr key={f.fault_type} className="border-t border-line">
                    <td className="py-2" style={{ color: CAUSE[f.fault_type as CauseKey]?.color }}>
                      {causeLabel(f.fault_type)}
                    </td>
                    <td className="py-2 text-right">×{f.fitted_multiplier.toFixed(2)}</td>
                    <td className="py-2 text-right">{f.bic.toFixed(1)}</td>
                    <td className="py-2 text-right">{f.residual_rmse_deg_c.toFixed(3)}°</td>
                    <td className="py-2 text-right">{Math.round((weights[f.fault_type] ?? 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Not scored yet.</Empty>
          )}
          <div className="mt-3 text-[11px] text-dim">Weight = exp(−BIC/2), normalised. Relative support between these three models, not a calibrated probability.</div>
        </Card>
      </div>

      <Card title="Telling the causes apart" sub={`ΔBIC between the two best explanations; above ${history.cause_gap_bic} the app names a cause. A leak and weak walls look alike on calm nights. Windy nights (blue, below) are what split them.`}>
        <NightsChart nights={n} height={170} legend={false} current={n} onPick={setAsOf} format={(v) => v.toFixed(0)} ref_={{ value: history.cause_gap_bic, label: `name-the-cause line (${history.cause_gap_bic})` }} series={[{ id: "g", label: "ΔBIC", color: "#c8ccd6", kind: "bar", values: strip.map((s) => s.snap?.cause_gap_bic ?? null), barColors: strip.map((s) => (s.snap ? CAUSE[s.snap.leading_cause as CauseKey].color : null)) }]} />
        <div className="mt-1 text-[11px] text-mute">Wind (m/s)</div>
        <NightsChart nights={n} height={64} legend={false} current={n} onPick={setAsOf} format={(v) => v.toFixed(0)} series={[{ id: "w", label: "Wind", color: "#4a5162", kind: "bar", values: history.nights.slice(0, n).map((x) => x.mean_wind_m_s), barColors: history.nights.slice(0, n).map((x) => (x.mean_wind_m_s >= WINDY ? "#3987e5" : null)) }]} />
      </Card>

      <Card title="Night-by-night log" sub="Exactly what the rule saw. Nights after a reported repair are judged on their own.">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-dim">
                {["Night", "Date", "Outside", "Wind", "Judged", "Extra loss", "Alarm", "Above?", "Leading", "ΔBIC", "Status"].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {strip.map(({ night }) => {
                const s = room.snapshots.find((x) => x.night_number === night);
                const x = history.nights[night - 1];
                return (
                  <tr key={night} onClick={() => setAsOf(night)} className={`cursor-pointer border-t border-line hover:bg-white/[0.03] ${night === n ? "bg-white/[0.05]" : ""}`}>
                    <td className="py-1.5 pr-3 font-semibold">{night}</td>
                    <td className="pr-3">{shortDate(x.start)}</td>
                    <td className="pr-3">{x.mean_outdoor_c.toFixed(1)}°</td>
                    <td className={`pr-3 ${x.mean_wind_m_s >= WINDY ? "text-[#9cc8ff]" : ""}`}>{x.mean_wind_m_s.toFixed(1)}</td>
                    <td className="pr-3" style={{ color: x.kind === "fan_test" ? FAN_COLOR : undefined }}>
                      {x.kind === "fan_test" ? "fan test: names cause only" : s ? `${s.nights_judged}${s.after_fix ? " (post-fix)" : ""}` : "–"}
                    </td>
                    <td className="pr-3">{s && x.kind !== "fan_test" ? `${s.extra_heat_loss_percent.toFixed(1)}%` : "–"}</td>
                    <td className="pr-3">{s && x.kind !== "fan_test" ? `${s.threshold_percent.toFixed(1)}%` : "–"}</td>
                    <td className={`pr-3 ${s?.candidate && x.kind !== "fan_test" ? "text-hot" : "text-dim"}`}>{s && x.kind !== "fan_test" ? (s.candidate ? "yes" : "no") : "–"}</td>
                    <td className="pr-3" style={{ color: s ? CAUSE[s.leading_cause as CauseKey].color : undefined }}>
                      {s ? causeLabel(s.leading_cause) : "–"}
                    </td>
                    <td className="pr-3">{s ? s.cause_gap_bic.toFixed(1) : "–"}</td>
                    <td style={{ color: s ? ROOM_STATUS[s.status].color : undefined }}>{s ? `${ROOM_STATUS[s.status].icon} ${ROOM_STATUS[s.status].label}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="The flag rule" sub="Tuned on simulated TRAINING homes; the alarm shrinks as 1/√nights so evidence must persist.">
          {technical ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px]">
              {technical.rule.map((r) => (
                <div key={r.name} className="contents">
                  <dt className="text-mute">{r.name}</dt>
                  <dd className="break-words text-ink">
                    {String(r.value)}
                    {r.unit ? <span className="text-dim"> {r.unit}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="font-mono text-[11.5px] text-mute">
              persistence_nights {history.persistence_nights} · cause_gap {history.cause_gap_bic} BIC
              <div className="mt-1 text-dim">Full rule shown when viewing the latest night.</div>
            </div>
          )}
        </Card>
        <Card title="Money assumptions" sub="Screening estimate from stated assumptions, not a quote or a certified audit.">
          {report?.money ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11.5px]">
              {report.money.assumptions.map((r) => (
                <div key={r.name} className="contents">
                  <dt className="text-mute">{r.name}</dt>
                  <dd className="break-words text-ink">
                    {String(r.value)}
                    {r.unit ? <span className="text-dim"> {r.unit}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="text-[12px] text-mute">{snap?.annual_cost_gbp != null ? "Shown when viewing the latest night." : "No cost: nothing flagged in this room."}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
