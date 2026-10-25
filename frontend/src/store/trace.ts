import { create } from "zustand";

export type TraceEntry = {
  id: number;
  label: string;
  route: string;
  startedAt: number;
  ms?: number;
  detail?: string;
  failed?: boolean;
};

type TraceState = {
  entries: TraceEntry[];
  start: (label: string, route: string) => number;
  finish: (id: number, ms: number, detail: string, failed?: boolean) => void;
  clear: () => void;
};

let next = 1;

export const useTrace = create<TraceState>((set) => ({
  entries: [],
  start: (label, route) => {
    const id = next++;
    set((s) => ({ entries: [...s.entries.slice(-30), { id, label, route, startedAt: Date.now() }] }));
    return id;
  },
  finish: (id, ms, detail, failed) =>
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ms, detail, failed } : e)) })),
  clear: () => set({ entries: [] }),
}));
