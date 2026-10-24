import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ConsumerApp from "./consumer/ConsumerApp";
import "./styles/index.css";

// The public site is the homeowner experience. The research console (Fault Lab,
// Real Homes, evidence) lives at #/lab for the team and judges.
const isLab = () => /^#\/?(lab|fault-lab|real-homes)/.test(window.location.hash);

function Root() {
  const [lab, setLab] = useState(isLab);
  useEffect(() => {
    const onHash = () => setLab(isLab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return lab ? <App /> : <ConsumerApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
