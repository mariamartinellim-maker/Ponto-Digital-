"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareText,
  MessagesSquare,
  QrCode,
  ScrollText,
  Sparkles,
  SquareKanban,
  UserCog,
  Users,
  Webhook,
  X,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { Avatar, cn } from "../ui";
import { Logo } from "./logo";
import { logoutAction } from "@/app/(auth)/actions";

const NAV: { href: string; label: string; icon: typeof Users; perm?: Permission; badge?: "unread" }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Users, perm: "clients:read" },
  { href: "/funil", label: "Funil comercial", icon: SquareKanban },
  { href: "/inbox", label: "Atendimento", icon: MessagesSquare, badge: "unread" },
  { href: "/agenda", label: "Agenda", icon: CalendarCheck },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone, perm: "campaigns:read" },
  { href: "/modelos", label: "Modelos e respostas", icon: MessageSquareText },
  { href: "/ia", label: "Assistente de IA", icon: Sparkles, perm: "ai:manage" },
];
const ADMIN: typeof NAV = [
  { href: "/equipe", label: "Equipe e permissões", icon: UserCog, perm: "users:manage" },
  { href: "/auditoria", label: "Auditoria", icon: ScrollText, perm: "audit:read" },
  { href: "/configuracoes/whatsapp", label: "WhatsApp Business", icon: Webhook, perm: "settings:manage" },
  { href: "/configuracoes/whatsapp-web", label: "WhatsApp Web (teste)", icon: QrCode, perm: "settings:manage" },
];

export interface NavUser {
  name: string;
  email: string;
  roleLabel: string;
  orgName: string;
  permissions: Permission[];
}

function NavLinks({ user, unread, onNavigate }: { user: NavUser; unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const item = (n: (typeof NAV)[number]) => {
    if (n.perm && !user.permissions.includes(n.perm)) return null;
    const active = pathname === n.href || pathname.startsWith(n.href + "/");
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors",
          active ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white",
        )}
      >
        <Icon className={cn("size-[18px]", active ? "text-brand-300" : "text-white/45 group-hover:text-white/80")} />
        <span className="flex-1">{n.label}</span>
        {n.badge === "unread" && unread > 0 && (
          <span className="rounded-full bg-coral-500 px-1.5 py-px text-[11px] font-semibold text-white">{unread}</span>
        )}
        {active && <span className="size-1.5 rounded-full bg-coral-500" />}
      </Link>
    );
  };
  const admin = ADMIN.map(item).filter(Boolean);
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 scroll-thin" aria-label="Menu principal">
      {NAV.map(item)}
      {admin.length > 0 && (
        <>
          <p className="mb-1 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">Administração</p>
          {admin}
        </>
      )}
    </nav>
  );
}

function UserBox({ user }: { user: NavUser }) {
  return (
    <div className="m-3 rounded-2xl bg-white/[0.05] p-3">
      <div className="flex items-center gap-3">
        <Avatar name={user.name} className="!bg-brand-500/25 !text-brand-200" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white">{user.name}</p>
          <p className="truncate text-[11.5px] text-white/45">{user.roleLabel}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            title="Sair"
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            <LogOut className="size-4" />
            <span className="sr-only">Sair</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppNav({ user, unread }: { user: NavUser; unread: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink-950 lg:flex">
        <div className="px-5 pb-6 pt-6">
          <Logo dark />
        </div>
        <NavLinks user={user} unread={unread} />
        <UserBox user={user} />
      </aside>

      {/* Mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/5 bg-ink-950 px-4 lg:hidden">
        <Logo dark />
        <button
          onClick={() => setOpen(true)}
          className="relative rounded-lg p-2 text-white/80 hover:bg-white/10"
          aria-label="Abrir menu"
          aria-expanded={open}
        >
          <Menu className="size-5" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-coral-500" />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-ink-950 shadow-pop">
            <div className="flex items-center justify-between px-5 pb-6 pt-5">
              <Logo dark />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-white/70 hover:bg-white/10" aria-label="Fechar menu">
                <X className="size-5" />
              </button>
            </div>
            <NavLinks user={user} unread={unread} onNavigate={() => setOpen(false)} />
            <UserBox user={user} />
          </aside>
        </div>
      )}
    </>
  );
}
