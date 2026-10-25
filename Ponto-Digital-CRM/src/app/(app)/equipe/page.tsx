import { ReadOnlyNotice } from "@/components/layout/demo-banner";
import { Check, Minus } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { scoped } from "@/lib/data/repo";
import type { Role } from "@/lib/data/types";
import { formatDateTime } from "@/lib/format";
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { createUserAction, resetUserPasswordAction, updateUserAction } from "./actions";

export const metadata = { title: "Equipe e permissões" };
export const instant = false;

const ROLES = Object.keys(ROLE_LABELS) as Role[];

export default async function TeamPage() {
  const user = await requireUser("users:manage");
  const d = await scoped(user.orgId);

  return (
    <>
      <PageHeader title="Equipe e permissões" description="Crie acessos individuais para cada pessoa da equipe. Nunca compartilhe logins." />
      <ReadOnlyNotice />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Usuários" description={`${d.users.filter((u) => u.active).length} ativos`} />
          <ul className="divide-y divide-line">
            {d.users.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.name} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {u.name}
                      {u.id === user.id && <Badge tone="brand">Você</Badge>}
                      {!u.active && <Badge tone="red">Desativado</Badge>}
                    </p>
                    <p className="truncate text-xs text-slate-500">{u.email} · último acesso {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "nunca"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateUserAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="op" value="role" />
                    <Select name="role" defaultValue={u.role} className="h-8 w-36 text-[13px]" aria-label={`Perfil de ${u.name}`}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </Select>
                    <Button size="sm" variant="outline">Salvar</Button>
                  </form>
                  <form action={updateUserAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="op" value="toggle" />
                    <Button size="sm" variant={u.active ? "ghost" : "secondary"} disabled={u.id === user.id}>{u.active ? "Desativar" : "Reativar"}</Button>
                  </form>
                  <ActionForm action={resetUserPasswordAction} submitLabel="Nova senha" className="contents">
                    <input type="hidden" name="id" value={u.id} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="xl:self-start">
          <CardHeader title="Adicionar pessoa" />
          <div className="p-5">
            <ActionForm action={createUserAction} submitLabel="Criar acesso" success="Usuário criado.">
              <Field label="Nome" htmlFor="name"><Input id="name" name="name" required /></Field>
              <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" required /></Field>
              <Field label="Perfil" htmlFor="role">
                <Select id="role" name="role" defaultValue="atendente">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
              </Field>
            </ActionForm>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Matriz de permissões" description="O que cada perfil pode fazer. As regras são verificadas no servidor em todas as ações." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Permissão</th>
                {ROLES.map((r) => <th key={r} className="px-3 py-3 text-center font-medium">{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([p, label]) => (
                <tr key={p}>
                  <td className="px-5 py-2.5 text-slate-700">{label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center">
                      {ROLE_PERMISSIONS[r].includes(p) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Sim" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="Não" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
