import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ChatDock } from "./components/ChatDock";
import "./styles/index.css";

const Landing = lazy(() => import("./pages/Landing"));
const Lab = lazy(() => import("./pages/Lab"));
const Real = lazy(() => import("./pages/Real"));
const MyHome = lazy(() => import("./pages/MyHome"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="grid h-screen place-items-center text-mute">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/real" element={<Real />} />
          <Route path="/home" element={<MyHome />} />
        </Routes>
      </Suspense>
      <ChatDock />
    </BrowserRouter>
  </StrictMode>,
);
