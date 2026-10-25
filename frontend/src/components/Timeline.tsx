import { Pause, Play } from "lucide-react";
import { fmtDate, fmtTime } from "../lib/rooms";
import { useScene } from "../store/scene";

type Props = {
  t: number | null;
  range: [number, number] | null;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (t: number) => void;
  caption?: string;
  className?: string;
};

export function Timeline({ t, range, playing, onPlay, onPause, onScrub, caption, className = "" }: Props) {
  const outdoor = useScene((s) => s.outdoor);
  const wind = useScene((s) => s.wind);
  if (!range || t == null) return null;
  const k = (t - range[0]) / (range[1] - range[0]);
  return (
    <div className={`glass rounded-2xl px-4 py-3 ${className}`}>
      <div className="flex items-center gap-3">
        <button onClick={playing ? onPause : onPlay} className="grid h-9 w-9 place-items-center rounded-full bg-ink text-black" aria-label={playing ? "Pause" : "Play the night"}>
          {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-[11px] text-mute">
            <span className="num">{fmtTime(range[0])}</span>
            <span className="num text-[13px] font-semibold text-ink">
              {fmtTime(t)} <span className="font-normal text-mute">· {fmtDate(t)}</span>
            </span>
            <span className="num">{fmtTime(range[1])}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(k * 1000)}
            onChange={(e) => onScrub(range[0] + (Number(e.target.value) / 1000) * (range[1] - range[0]))}
            className="mt-1 w-full"
            aria-label="Time of night"
          />
        </div>
        <div className="hidden w-24 text-right text-[11px] leading-tight text-mute sm:block">
          <div>
            Outside <b className="num text-[15px] text-ink">{outdoor == null ? "–" : `${outdoor.toFixed(1)}°`}</b>
          </div>
          <div className="num">{wind == null ? "" : `wind ${wind.toFixed(1)} m/s`}</div>
        </div>
      </div>
      {caption && <div className="mt-1.5 text-[11px] text-dim">{caption}</div>}
    </div>
  );
}
