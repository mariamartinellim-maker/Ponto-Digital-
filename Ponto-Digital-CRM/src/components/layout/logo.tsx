import { cn } from "../ui";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <defs>
        <linearGradient id="pd-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6E4FF6" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#pd-g)" />
      <path d="M13 29V11h7.2a6.3 6.3 0 0 1 0 12.6H17" stroke="#fff" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28.5" cy="28.5" r="3.6" fill="#FF6B4A" />
    </svg>
  );
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className={cn("block text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-slate-900")}>
          ponto digital<span className="text-coral-500">.</span>
        </span>
        <span className={cn("block text-[11px] font-medium uppercase tracking-[0.14em]", dark ? "text-white/45" : "text-slate-400")}>
          CRM
        </span>
      </span>
    </span>
  );
}
