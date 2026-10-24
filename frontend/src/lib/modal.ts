import { useEffect, useState } from "react";

// Open dialogs register here so expensive views (the WebGL house) can pause.
let open = 0;
const listeners = new Set<(n: number) => void>();

export function useRegisterModal(active = true) {
  useEffect(() => {
    if (!active) return;
    open += 1;
    listeners.forEach((l) => l(open));
    return () => {
      open -= 1;
      listeners.forEach((l) => l(open));
    };
  }, [active]);
}

export function useAnyModalOpen(): boolean {
  const [count, setCount] = useState(open);
  useEffect(() => {
    listeners.add(setCount);
    return () => {
      listeners.delete(setCount);
    };
  }, []);
  return count > 0;
}
