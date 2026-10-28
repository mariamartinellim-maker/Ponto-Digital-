"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import type { BusinessProfile } from "@/lib/whatsapp/profile";
import { updateProfileAction } from "./actions";

/** Formulário do perfil comercial do número oficial, já preenchido com o perfil atual (ou o sugerido). */
export function ProfileForm({ profile, verticals, photoUrl }: { profile: BusinessProfile; verticals: Record<string, string>; photoUrl: string | null }) {
  return (
    <ActionForm action={updateProfileAction} submitLabel="Salvar no WhatsApp" success="Perfil do WhatsApp atualizado." className="space-y-4 p-5">
      <div className="flex items-center gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Foto de perfil atual" className="size-16 rounded-full border border-line object-cover" />
        ) : (
          <div className="size-16 rounded-full bg-slate-100" />
        )}
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="usarLogo" defaultChecked={!photoUrl} /> Usar a logo da Ponto Digital como foto
          </label>
          <Input type="file" name="foto" accept="image/jpeg,image/png" aria-label="Ou envie outra foto" className="text-xs" />
        </div>
      </div>
      <Field label="Recado (aparece embaixo do nome)" htmlFor="about">
        <Input id="about" name="about" maxLength={139} defaultValue={profile.about} />
      </Field>
      <Field label="Descrição" htmlFor="description">
        <Textarea id="description" name="description" rows={4} maxLength={512} defaultValue={profile.description} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoria" htmlFor="vertical">
          <Select id="vertical" name="vertical" defaultValue={profile.vertical}>
            {Object.entries(verticals).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Endereço" htmlFor="address">
          <Input id="address" name="address" maxLength={256} defaultValue={profile.address} />
        </Field>
        <Field label="Site 1 (ex.: Instagram)" htmlFor="site1">
          <Input id="site1" name="site1" type="url" defaultValue={profile.websites[0] ?? ""} />
        </Field>
        <Field label="Site 2" htmlFor="site2">
          <Input id="site2" name="site2" type="url" defaultValue={profile.websites[1] ?? ""} />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" maxLength={128} defaultValue={profile.email} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Capa e horário de atendimento a Meta não libera pela API: esses ficam só no app WhatsApp Business.</p>
    </ActionForm>
  );
}
