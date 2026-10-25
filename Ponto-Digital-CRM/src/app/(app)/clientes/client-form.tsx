"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice, Select, Textarea, cn } from "@/components/ui";
import { SERVICES, type Client } from "@/lib/data/types";
import { formatPhone } from "@/lib/phone";
import { saveClientAction } from "./actions";

export function ClientForm({ client, users }: { client?: Client; users: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveClientAction, undefined);
  const err = state?.fieldErrors ?? {};
  const services = new Set([...SERVICES, ...(client?.services ?? [])]);
  return (
    <form action={action} className="space-y-5">
      {client && <input type="hidden" name="id" value={client.id} />}
      {state?.error && <Notice tone="red">{state.error}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome do cliente / empresa *" htmlFor="name" hint={err.name}>
          <Input id="name" name="name" required defaultValue={client?.name} aria-invalid={!!err.name} className={cn(err.name && "border-red-400")} />
        </Field>
        <Field label="Telefone (WhatsApp) *" htmlFor="phone" hint={err.phone ?? "Com DDD. Ex.: (11) 99999-0000"}>
          <Input id="phone" name="phone" required inputMode="tel" defaultValue={client ? formatPhone(client.phone) : ""} aria-invalid={!!err.phone} className={cn(err.phone && "border-red-400")} />
        </Field>
        <Field label="E-mail" htmlFor="email" hint={err.email}>
          <Input id="email" name="email" type="email" defaultValue={client?.email} />
        </Field>
        <Field label="Cidade" htmlFor="city">
          <Input id="city" name="city" defaultValue={client?.city} />
        </Field>
        <Field label="Responsável" htmlFor="ownerId">
          <Select id="ownerId" name="ownerId" defaultValue={client?.ownerId ?? ""}>
            <option value="">Eu mesmo(a)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Etiquetas" htmlFor="tags" hint="Separe por vírgula. Ex.: VIP, Indicação">
          <Input id="tags" name="tags" defaultValue={client?.tags.join(", ")} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-slate-700">Serviços contratados</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...services].map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:bg-slate-50 has-checked:border-brand-300 has-checked:bg-brand-50">
              <input type="checkbox" name="services" value={s} defaultChecked={client?.services.includes(s)} className="accent-brand-600" />
              {s}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={4} defaultValue={client?.notes} />
      </Field>

      {!client && (
        <label className="flex items-start gap-3 rounded-xl border border-line bg-slate-50 p-3 text-sm">
          <input type="checkbox" name="consent" className="mt-0.5 accent-brand-600" />
          <span>
            <span className="font-medium text-slate-800">O cliente autorizou receber mensagens pelo WhatsApp</span>
            <span className="block text-xs text-slate-500">Marque apenas se houver consentimento explícito (LGPD). O registro fica no histórico do cliente.</span>
          </span>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : client ? "Salvar alterações" : "Cadastrar cliente"}</Button>
      </div>
    </form>
  );
}
