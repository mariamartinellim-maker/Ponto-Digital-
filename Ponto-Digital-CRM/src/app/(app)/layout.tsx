import { Suspense } from "react";
import { AppNav } from "@/components/layout/app-nav";
import { getSessionUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { ROLE_LABELS, ROLE_PERMISSIONS, can } from "@/lib/permissions";
import { DemoBanner } from "@/components/layout/demo-banner";

// Área autenticada: toda página depende da sessão (cookie), então a navegação pode aguardar o servidor.
export const instant = false;

async function Nav() {
  const user = await getSessionUser();
  if (!user) return null;
  const data = await scoped(user.orgId);
  const seeAll = can(user.role, "inbox:read_all");
  const unread = data.conversations
    .filter((c) => c.status !== "resolvida" && (seeAll || c.assigneeId === user.id || !c.assigneeId))
    .reduce((n, c) => n + c.unread, 0);
  return (
    <AppNav
      unread={unread}
      user={{
        name: user.name,
        email: user.email,
        orgName: user.orgName,
        roleLabel: ROLE_LABELS[user.role],
        permissions: ROLE_PERMISSIONS[user.role],
      }}
    />
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Suspense fallback={<aside className="fixed inset-y-0 left-0 hidden w-64 bg-ink-950 lg:block" />}>
        <Nav />
      </Suspense>
      <div className="lg:pl-64">
        <DemoBanner />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
