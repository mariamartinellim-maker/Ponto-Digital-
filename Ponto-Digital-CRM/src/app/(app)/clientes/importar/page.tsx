import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Importar contatos" };
export const instant = false;

export default async function ImportPage() {
  await requireUser("clients:import");
  return (
    <>
      <PageHeader
        title="Importar contatos"
        description="Os telefones são padronizados e duplicidades são eliminadas automaticamente (inclusive números com e sem o nono dígito)."
      />
      <ImportFlow />
    </>
  );
}
