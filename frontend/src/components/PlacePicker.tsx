import { Check, Loader2, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api, traced } from "../api/client";
import type { Location } from "../api/types";

type Props = {
  value: Location | null;
  onChange: (place: Location | null) => void;
};

/**
 * Town or UK postcode search: only a real place picked from the suggestions counts,
 * so the home is created from known coordinates (no lookup, nothing to time out).
 */
export function PlacePicker({ value, onChange }: Props) {
  const [text, setText] = useState(value?.name ?? "");
  const [options, setOptions] = useState<Location[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = text.trim();
    if (value || q.length < 2) {
      setOptions([]);
      setMessage(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await traced("places", "GET /places", () => api.GET("/api/places", { params: { query: { q } }, signal: ctrl.signal }), (d) => `${d.length} places`);
        setOptions(found);
        setActive(0);
        setOpen(true);
        setMessage(found.length ? null : `No town or postcode called “${q}”. Check the spelling, or try a nearby town.`);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setOptions([]);
        setMessage(e instanceof ApiError && e.status === 503 ? "Place search is unreachable right now. Check the connection and try again." : `Couldn't search places (${e instanceof Error ? e.message : e}).`);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, value]);

  const pick = (p: Location) => {
    onChange(p);
    setText(p.name);
    setOpen(false);
    setOptions([]);
  };

  return (
    <div>
      <div className="relative mt-1">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => options.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !options.length) return;
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => (a + 1) % options.length));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => (a - 1 + options.length) % options.length));
            else if (e.key === "Enter") (e.preventDefault(), pick(options[active]));
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Start typing, e.g. Loughborough or LE11 3TU"
          autoComplete="off"
          className={`w-full rounded-lg border bg-transparent py-2 pl-3 pr-9 text-ink outline-none placeholder:text-dim focus:border-white/40 ${value ? "border-ok/60" : "border-line"}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mute">
          {searching ? <Loader2 size={14} className="animate-spin" /> : value ? <Check size={14} className="text-ok" /> : null}
        </span>
        {open && options.length > 0 && (
          <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line bg-[#0d1119] shadow-xl">
            {options.map((p, i) => (
              <button
                key={`${p.name}-${p.latitude}-${p.longitude}`}
                onMouseDown={(e) => (e.preventDefault(), pick(p))}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] ${i === active ? "bg-white/10 text-ink" : "text-mute"}`}
              >
                <MapPin size={12} className="shrink-0" />
                <span className="truncate">{p.name}</span>
                <span className="num ml-auto shrink-0 text-[10.5px] text-dim">
                  {p.latitude?.toFixed(2)}, {p.longitude?.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {value ? (
        <div className="mt-1 text-[11px] text-ok">
          Weather will come from {value.latitude?.toFixed(3)}, {value.longitude?.toFixed(3)}.
        </div>
      ) : message ? (
        <div className="mt-1 text-[11px] text-hot">{message}</div>
      ) : text.trim().length >= 2 && !searching ? (
        <div className="mt-1 text-[11px] text-dim">Pick your place from the list.</div>
      ) : null}
    </div>
  );
}
