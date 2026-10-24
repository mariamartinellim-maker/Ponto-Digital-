import { Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import { SERVICES } from "@/lib/data/types";
import { CampaignForm } from "./campaign-form";

export const metadata = { title: "Nova campanha" };
export const instant = false;

export default async function NewCampaignPage() {
  const user = await requireUser("campaigns:manage");
  const d = await scoped(user.orgId);
  const templates = d.templates.filter((t) => t.status === "APPROVED");
  const cities = [...new Set(d.clients.map((c) => c.city).filter(Boolean))].sort();
  const services = [...new Set([...SERVICES, ...d.clients.flatMap((c) => c.services)])];
  const tags = [...new Set(d.clients.flatMap((c) => c.tags))].sort();
  return (
    <>
      <PageHeader title="Nova campanha" description="Defina o modelo e o público. Contatos sem consentimento ou descadastrados são excluídos automaticamente." />
      {templates.length === 0 ? (
        <Notice tone="amber">Nenhum modelo aprovado. Cadastre um modelo em “Modelos e respostas”.</Notice>
      ) : (
        <CampaignForm cities={cities} services={services} tags={tags} templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body, category: t.category }))} />
      )}
    </>
  );
}
