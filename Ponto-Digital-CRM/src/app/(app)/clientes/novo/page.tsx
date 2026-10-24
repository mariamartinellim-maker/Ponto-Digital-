import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { ClientForm } from "../client-form";

export const metadata = { title: "Novo cliente" };
export const instant = false;

export default async function NewClientPage() {
  const user = await requireUser("clients:write");
  const d = await scoped(user.orgId);
  return (
    <>
      <PageHeader title="Novo cliente" description="Cadastre um cliente ou lead. Uma oportunidade é criada automaticamente no funil." />
      <Card className="p-5 sm:p-6">
        <ClientForm users={d.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))} />
      </Card>
    </>
  );
}
