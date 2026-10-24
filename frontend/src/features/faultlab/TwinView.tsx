import { Box, LayoutGrid } from "lucide-react";
import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from "react";
import { Spinner } from "../../components/ui";
import { TwinHouse } from "./TwinHouse";

const House3D = lazy(() => import("./House3D"));

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Props = ComponentProps<typeof TwinHouse> & { idle: boolean; simpleLabels?: boolean; height?: number };

export function TwinView({ idle, simpleLabels, height = 460, ...props }: Props) {
  const [has3d] = useState(webglAvailable);
  const [mode, setMode] = useState<"3d" | "plan">(has3d ? "3d" : "plan");
  const plan = (
    <div className="p-2">
      <TwinHouse {...props} />
    </div>
  );
  return (
    <div className="relative">
      {mode === "3d" && has3d ? (
        <Fallback fallback={plan}>
          <Suspense
            fallback={
              <div className="grid place-items-center text-[12px] text-accent" style={{ height }}>
                <span className="flex items-center gap-2">
                  <Spinner /> Loading 3D house…
                </span>
              </div>
            }
          >
            <House3D {...props} idle={idle} simpleLabels={simpleLabels} height={height} />
          </Suspense>
        </Fallback>
      ) : (
        plan
      )}
      <div className="absolute bottom-3 left-3 flex gap-1 rounded-lg border border-white/10 bg-black/40 p-1 backdrop-blur">
        <button
          onClick={() => setMode("3d")}
          disabled={!has3d}
          title={has3d ? "3D view" : "3D needs WebGL, which this browser does not provide"}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${mode === "3d" ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink"} disabled:opacity-40`}
        >
          <Box size={12} /> 3D
        </button>
        <button
          onClick={() => setMode("plan")}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${mode === "plan" ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          <LayoutGrid size={12} /> Plan
        </button>
      </div>
    </div>
  );
}
