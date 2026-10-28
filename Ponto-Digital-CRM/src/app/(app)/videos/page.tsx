import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { Badge, Card, CardHeader, Field, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";
import { listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import type { VideoOrder } from "@/lib/data/types";
import { formatDateTime } from "@/lib/format";
import { allowedActions, MAX_SPEECH_WORDS, MODALITIES, MODALITY_LABEL, VIDEO_COLUMNS, VIDEO_STATUS } from "@/lib/video/rules";
import { getSettings, listStates, modalityLabel, STAGE_LABEL } from "@/lib/video/autopilot";
import { videoUsage, withStuck } from "@/lib/video/service";
import { autopilotConversationAction, createVideoAction, saveAutopilotAction } from "./actions";
import { AutoRefresh, OrderActions } from "./order-actions";

export const metadata = { title: "Vídeos com avatar" };
export const instant = false;

const file = (id: string | null) => (id ? `/api/biblioteca/${id}` : null);

export default async function VideosPage() {
  const user = await requireUser("videos:manage");
  const [raw, d, usage, settings, states, audios] = await Promise.all([
    listAll(user.orgId, "videoOrders", { order: "updatedAt", desc: true }),
    scoped(user.orgId),
    videoUsage(user.orgId),
    getSettings(user.orgId),
    listStates(user.orgId),
    listAll(user.orgId, "mediaAssets", { where: { type: "audio" }, order: "createdAt", desc: true, limit: 100 }),
  ]);
  const canConfigure = user.role !== "atendente";
  const orders = raw.map(withStuck);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const generating = orders.some((o) => o.status === "gerando_avatar" || o.status === "gerando_video");
  const finished = orders.filter((o) => o.status === "entregue" || o.status === "cancelado").slice(0, 15);

  const OrderCard = ({ o }: { o: VideoOrder }) => {
    const st = VIDEO_STATUS[o.status];
    const media = [
      { label: "Foto", src: file(o.photoAssetId), kind: "img" },
      { label: "Avatar", src: file(o.avatarAssetId), kind: "img" },
      { label: "Prévia", src: file(o.previewAssetId), kind: "video" },
    ].filter((m) => m.src);
    return (
      <li data-video={o.number}>
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[11px] text-slate-400">#{o.number} · {MODALITY_LABEL[o.modality]} · {o.engine === "ia" ? "IA" : "simulador"}</p>
              <p className="text-sm font-semibold">{o.driverName}</p>
              <p className="text-xs text-slate-500">
                <Link href={`/clientes/${o.clientId}`} className="hover:text-brand-700">{clients.get(o.clientId) ?? "Cliente"}</Link>
                {o.conversationId && <> · <Link href={`/inbox/${o.conversationId}`} className="hover:text-brand-700">conversa</Link></>}
              </p>
            </div>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600">“{o.speech}”</p>
          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {media.map((m) => (
                <a key={m.label} href={m.src!} target="_blank" rel="noreferrer" className="block text-center text-[11px] text-slate-500 hover:text-brand-700">
                  {m.kind === "img" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.src!} alt={`${m.label} do pedido ${o.number}`} loading="lazy" className="aspect-[9/16] w-full rounded-lg object-cover" />
                  ) : (
                    <video src={m.src!} preload="metadata" muted className="aspect-[9/16] w-full rounded-lg bg-black object-cover" aria-label={`${m.label} do pedido ${o.number}`} />
                  )}
                  {m.label}
                </a>
              ))}
            </div>
          )}
          {o.videoAssetId && (o.status === "pago" || o.status === "entregue") && (
            <a href={`${file(o.videoAssetId)}?baixar=1`} className="text-xs font-medium text-brand-700 hover:underline">Baixar vídeo final (sem marca)</a>
          )}
          {o.error && o.status === "falhou" && <Notice tone="red">{o.error}</Notice>}
          {o.adjustments && <p className="text-[11px] text-slate-500">Últimos ajustes: {o.adjustments}</p>}
          <OrderActions
            id={o.id}
            actions={allowedActions(o).filter((a) => a !== "cancelar" || user.role !== "atendente")}
            done={{ avatar: Boolean(o.avatarAssetId), video: Boolean(o.videoAssetId), avatarSent: Boolean(o.avatarSentAt), previewSent: Boolean(o.previewSentAt) }}
          />
          <p className="text-[11px] text-slate-400">Atualizado {formatDateTime(o.updatedAt)} · avatar {o.avatarRuns}x · vídeo {o.videoRuns}x</p>
        </Card>
      </li>
    );
  };

  return (
    <>
      <AutoRefresh active={generating} />
      <PageHeader
        title="Vídeos com avatar"
        description="Foto do cliente → avatar → aprovação → vídeo de 10 s → prévia com marca d'água → pagamento → vídeo final."
      />
      {usage.engine === "simulador" ? (
        <Notice tone="amber" title="Modo simulador (sem custo)">
          {!usage.enabled
            ? "A automação paga está desligada (VIDEO_AUTOMACAO). "
            : `Falta configurar ${[!usage.avatar && "OPENAI_API_KEY", !usage.video && "GOOGLE_AI_API_KEY"].filter(Boolean).join(" e ")} no Render. `}
          O &quot;avatar&quot; é a própria foto e o &quot;vídeo&quot; é a foto animada, só para testar o fluxo. Nenhuma IA é chamada.
        </Notice>
      ) : (
        <Notice tone={usage.left > 0 ? "brand" : "red"} title="IA ligada (OpenAI + Veo)">
          {usage.used} de {usage.limit} gerações pagas usadas neste mês. {usage.left > 0 ? `Restam ${usage.left}.` : "Limite atingido: novas gerações estão bloqueadas."}
        </Notice>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {VIDEO_COLUMNS.map((col) => {
          const list = orders.filter((o) => col.statuses.includes(o.status));
          if (col.id === "problema" && !list.length) return null;
          return (
            <section key={col.id} aria-label={col.label} className="rounded-2xl bg-slate-50 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">{col.label} <Badge>{list.length}</Badge></h2>
              {list.length === 0 ? <p className="px-1 py-6 text-center text-xs text-slate-400">Vazio</p> : <ul className="space-y-3">{list.map((o) => <OrderCard key={o.id} o={o} />)}</ul>}
            </section>
          );
        })}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardHeader
            title="Atendimento automático"
            description={settings?.enabled ? (settings.testOnly ? "LIGADO só para os números de teste." : "LIGADO para clientes.") : "Desligado."}
          />
          {states.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nenhuma conversa atendida pelo robô ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {states.map((st) => (
                <li key={st.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Link href={`/inbox/${st.conversationId}`} className="flex-1 truncate font-medium hover:text-brand-700">{clients.get(st.clientId) ?? "Cliente"}</Link>
                  <span className="text-xs text-slate-500">{modalityLabel(st.modality)}</span>
                  <Badge tone={st.stage === "humano" ? "amber" : st.stage === "finalizado" ? "green" : "sky"}>{STAGE_LABEL[st.stage]}</Badge>
                  {st.note && <span className="w-full text-xs text-slate-500">{st.note}</span>}
                  <span className="text-xs text-slate-400">{formatDateTime(st.updatedAt)}</span>
                  <form action={autopilotConversationAction} className="flex gap-1.5">
                    <input type="hidden" name="id" value={st.id} />
                    {st.stage !== "humano" && st.stage !== "finalizado" && (
                      <button name="action" value="pausar" className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-slate-50">Assumir (pausar robô)</button>
                    )}
                    {canConfigure && (
                      <button name="action" value="reiniciar" className="rounded-lg border border-line px-2 py-1 text-xs font-medium hover:bg-slate-50">Reiniciar</button>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canConfigure && (
          <Card className="xl:self-start">
            <CardHeader title="Configurar o robô" description="Atende sozinho quem chega pelo anúncio, por escrito ou com os áudios gravados." />
            <div className="p-5">
              <ActionForm action={saveAutopilotAction} submitLabel="Salvar" success="Salvo." className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} className="size-4" /> Ligar atendimento automático
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="testOnly" defaultChecked={settings?.testOnly ?? true} className="size-4" /> Só números de teste (desmarque para atender clientes)
                </label>
                <Field label="Quando começar" htmlFor="trigger">
                  <Select id="trigger" name="trigger" defaultValue={settings?.trigger ?? "anuncio"}>
                    <option value="anuncio">Contato novo vindo de anúncio</option>
                    <option value="contato_novo">Qualquer contato novo</option>
                  </Select>
                </Field>
                <Field label="Valor do vídeo" htmlFor="priceText" hint='Como aparece na mensagem, ex.: "R$ 50"'>
                  <Input id="priceText" name="priceText" maxLength={300} defaultValue={settings?.priceText ?? ""} />
                </Field>
                <Field label="Chave Pix" htmlFor="pixKey" hint="CPF, CNPJ, e-mail, +55 com DDD ou chave aleatória">
                  <Input id="pixKey" name="pixKey" maxLength={120} defaultValue={settings?.pixKey ?? ""} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Titular da chave" htmlFor="pixHolder" hint="Aparece no cartão Pix">
                    <Input id="pixHolder" name="pixHolder" maxLength={60} defaultValue={settings?.pixHolder ?? ""} />
                  </Field>
                  <Field label="Cidade do titular" htmlFor="pixCity">
                    <Input id="pixCity" name="pixCity" maxLength={40} defaultValue={settings?.pixCity ?? "Cuiaba"} />
                  </Field>
                </div>
                <Field label="Áudio de boas-vindas (pergunta o segmento)" htmlFor="audioAskAssetId" hint="Da biblioteca de mídias. Sem áudio, vai por escrito.">
                  <Select id="audioAskAssetId" name="audioAskAssetId" defaultValue={settings?.audioAskAssetId ?? ""}>
                    <option value="">Por escrito</option>
                    {audios.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                  </Select>
                </Field>
                <Field label='Áudio "foto e informações"' htmlFor="audioPhotoAssetId">
                  <Select id="audioPhotoAssetId" name="audioPhotoAssetId" defaultValue={settings?.audioPhotoAssetId ?? ""}>
                    <option value="">Por escrito</option>
                    {audios.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                  </Select>
                </Field>
              </ActionForm>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Entregues e cancelados" />
          {finished.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500"><Clapperboard className="mr-1 inline size-4" /> Nenhum pedido encerrado ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {finished.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3 text-sm" data-video={o.number}>
                  <span className="font-mono text-xs text-slate-400">#{o.number}</span>
                  <span className="flex-1 truncate">{o.driverName} · {clients.get(o.clientId) ?? "Cliente"}</span>
                  {o.videoAssetId && o.status === "entregue" && <a href={`${file(o.videoAssetId)}?baixar=1`} className="text-xs font-medium text-brand-700 hover:underline">Baixar</a>}
                  <Badge tone={VIDEO_STATUS[o.status].tone}>{VIDEO_STATUS[o.status].label}</Badge>
                  <span className="text-xs text-slate-500">{formatDateTime(o.deliveredAt ?? o.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:self-start">
          <CardHeader title="Novo pedido de vídeo" description="Com a foto e as informações que o cliente mandou." />
          <div className="p-5">
            <ActionForm action={createVideoAction} submitLabel="Criar pedido" success="Pedido criado.">
              <Field label="Cliente" htmlFor="clientId">
                <Select id="clientId" name="clientId" required>
                  <option value="">— Escolha —</option>
                  {[...d.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Foto do cliente" htmlFor="photo" hint="JPG, PNG ou WEBP, rosto bem visível. Se for print, recorte a tela antes.">
                <Input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Modalidade" htmlFor="modality">
                  <Select id="modality" name="modality" required defaultValue="">
                    <option value="" disabled>—</option>
                    {MODALITIES.map((m) => (
                      <option key={m} value={m}>{MODALITY_LABEL[m]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Motorista" htmlFor="driverGender">
                  <Select id="driverGender" name="driverGender" required defaultValue="masculino">
                    <option value="masculino">Homem</option>
                    <option value="feminino">Mulher</option>
                  </Select>
                </Field>
              </div>
              <Field label="Nome no vídeo (logo final)" htmlFor="driverName" hint='Nome e modalidade. Sem nome de empresa, use algo genérico como "Motorista RJ".'>
                <Input id="driverName" name="driverName" required maxLength={80} />
              </Field>
              <Field label="Fala do motorista" htmlFor="speech" hint={`Até ${MAX_SPEECH_WORDS} palavras (cerca de 8 s de fala).`}>
                <Textarea id="speech" name="speech" rows={3} required maxLength={400} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="WhatsApp no vídeo" htmlFor="contactPhone" hint="Vazio = número do cliente">
                  <Input id="contactPhone" name="contactPhone" inputMode="tel" maxLength={30} />
                </Field>
                <Field label="Cidade" htmlFor="city" hint="Paisagem nas janelas">
                  <Input id="city" name="city" maxLength={80} />
                </Field>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
