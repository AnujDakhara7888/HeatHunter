import { NavLink } from "react-router-dom";

const link = ({ isActive }: { isActive: boolean }) =>
  `transition-colors ${isActive ? "text-ink" : "text-mute hover:text-ink"}`;

export function Nav({ transparent = false }: { transparent?: boolean }) {
  return (
    <header className={`fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-7 px-6 text-[13px] ${transparent ? "" : "border-b border-line bg-[#05070bcc] backdrop-blur-xl"}`}>
      <NavLink to="/" className="mr-auto flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <path d="M6 17 16 8l10 9v8H6z" fill="none" stroke="#f2f3f5" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="16" cy="20" r="3" fill="#ff6a3d" />
        </svg>
        HeatHunter
      </NavLink>
      <NavLink to="/lab" className={link}>Fault Lab</NavLink>
      <NavLink to="/home" className={link}>Your home</NavLink>
      <NavLink to="/lab" className="btn btn-primary !px-4 !py-1.5 !text-[13px]">Start the night →</NavLink>
    </header>
  );
}
