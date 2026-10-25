import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; title?: string; onReset?: () => void; resetLabel?: string };

/** Shows a readable message instead of unmounting the whole page (a blank screen) when a view crashes. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("HeatHunter view crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-[#05070bf5] p-6">
        <div className="glass max-w-md rounded-3xl p-6 text-center">
          <div className="text-[18px] font-semibold">{this.props.title ?? "Something went wrong on this page."}</div>
          <p className="mt-2 font-mono text-[12px] text-mute">{error.message}</p>
          <button
            className="btn btn-primary mt-4"
            onClick={() => {
              this.setState({ error: null });
              (this.props.onReset ?? (() => window.location.reload()))();
            }}
          >
            {this.props.resetLabel ?? "Reload"}
          </button>
        </div>
      </div>
    );
  }
}
