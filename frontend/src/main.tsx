import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ChatDock } from "./components/ChatDock";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/index.css";

const Landing = lazy(() => import("./pages/Landing"));
const Lab = lazy(() => import("./pages/Lab"));
const MyHome = lazy(() => import("./pages/MyHome"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
      <Suspense fallback={<div className="grid h-screen place-items-center text-mute">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/home" element={<MyHome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      <ChatDock />
    </BrowserRouter>
  </StrictMode>,
);
