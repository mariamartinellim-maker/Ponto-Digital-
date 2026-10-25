import { requireUser } from "@/lib/auth/session";
import { InboxEmpty, InboxShell } from "./inbox-shell";

export const metadata = { title: "Atendimento" };
export const instant = false;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const user = await requireUser();
  const { f, q } = await searchParams;
  return (
    <InboxShell user={user} filter={f} q={q}>
      <InboxEmpty />
    </InboxShell>
  );
}
