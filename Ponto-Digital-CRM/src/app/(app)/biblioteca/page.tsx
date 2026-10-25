import Link from "next/link";
import { FileText, Film, ImageIcon, Library, Music, Trash2 } from "lucide-react";
import { Badge, buttonClass, Card, CardHeader, cn, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/action-form";
import { UploadForm } from "@/components/ui/upload-form";
import { requireUser } from "@/lib/auth/session";
import { listAll } from "@/lib/data/collections";
import { scoped } from "@/lib/data/repo";
import type { AssetType, MediaAsset } from "@/lib/data/types";
import { formatDateTime } from "@/lib/format";
import { canSeeConversation } from "@/lib/inbox";
import { MEDIA_LIMITS, storageReady } from "@/lib/media/storage";
import { can } from "@/lib/permissions";
import { deleteAssetAction, sendAssetAction } from "./actions";

export const metadata = { title: "Biblioteca de mídias" };
export const instant = false;

const ICON: Record<AssetType, typeof Music> = { image: ImageIcon, audio: Music, video: Film, document: FileText };
const SOURCE = { upload: "Enviado no CRM", whatsapp_web: "Recebido (WhatsApp Web)", whatsapp: "Recebido (WhatsApp)" } as const;
const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ACCEPT = Object.values(MEDIA_LIMITS).flatMap((r) => r.mimes).join(",");

function Preview({ a }: { a: MediaAsset }) {
  const src = `/api/biblioteca/${a.id}`;
  // eslint-disable-next-line @next/next/no-img-element
  if (a.type === "image") return <img src={src} alt={a.title} loading="lazy" className="h-40 w-full rounded-xl bg-slate-50 object-contain" />;
  if (a.type === "audio") return <audio controls preload="none" src={src} className="w-full" aria-label={a.title} />;
  if (a.type === "video") return <video controls preload="none" src={src} className="h-40 w-full rounded-xl bg-black" aria-label={a.title} />;
  return (
    <a href={src} target="_blank" rel="noopener" className="flex h-40 items-center justify-center gap-2 rounded-xl bg-slate-50 text-sm font-medium text-slate-600 hover:text-brand-700">
      <FileText className="size-5" /> Abrir PDF
    </a>
  );
}

export default async function BibliotecaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string }> }) {
  const user = await requireUser("media:read");
  const sp = await searchParams;
  const manage = can(user.role, "media:manage");
  const reply = can(user.role, "inbox:reply");
  const [assets, d] = await Promise.all([listAll(user.orgId, "mediaAssets", { order: "createdAt", desc: true }), scoped(user.orgId)]);
  const clients = new Map(d.clients.map((c) => [c.id, c.name]));
  const q = (sp.q ?? "").trim().toLowerCase();
  // Comprovantes ficam no Financeiro (dados pessoais e bancários).
  const visible = assets
    .filter((a) => !a.tags.includes("comprovante"))
    .filter((a) => !sp.tipo || a.type === sp.tipo)
    .filter((a) => !q || a.title.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)));
  const conversations = d.conversations.filter((c) => canSeeConversation(user, c)).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, 100);
  const ready = storageReady();

  return (
    <>
      <PageHeader title="Biblioteca de mídias" description={`${visible.length} arquivo(s) · áudios, imagens, vídeos e PDFs para usar no atendimento`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/biblioteca" className={buttonClass(!sp.tipo ? "secondary" : "ghost", "sm")}>Todos</Link>
        {(Object.keys(MEDIA_LIMITS) as AssetType[]).map((t) => (
          <Link key={t} href={`/biblioteca?tipo=${t}`} className={buttonClass(sp.tipo === t ? "secondary" : "ghost", "sm")}>{MEDIA_LIMITS[t].label}</Link>
        ))}
        <form className="ml-auto">
          {sp.tipo && <input type="hidden" name="tipo" value={sp.tipo} />}
          <Input name="q" defaultValue={sp.q} placeholder="Buscar por título ou etiqueta" aria-label="Buscar" className="w-64" />
        </form>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {visible.length === 0 ? (
            <Card><EmptyState icon={<Library className="size-5" />} title="Nenhum arquivo" description={manage ? "Envie áudios, imagens, vídeos ou PDFs pelo formulário ao lado." : "Peça a um gestor para adicionar arquivos."} /></Card>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((a) => {
                const Icon = ICON[a.type];
                return (
                  <li key={a.id} data-asset={a.title}>
                    <Card className="flex h-full flex-col gap-3 p-4">
                      <Preview a={a} />
                      <div className="flex items-start gap-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-brand-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{a.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {size(a.size)} · {SOURCE[a.source]} · {formatDateTime(a.createdAt)}
                            {a.clientId && clients.get(a.clientId) && <> · <Link className="hover:text-brand-700" href={`/clientes/${a.clientId}`}>{clients.get(a.clientId)}</Link></>}
                          </p>
                        </div>
                        {manage && (
                          <form action={deleteAssetAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <button className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir ${a.title}`}><Trash2 className="size-4" /></button>
                          </form>
                        )}
                      </div>
                      {a.tags.length > 0 && <div className="flex flex-wrap gap-1">{a.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
                      {reply && conversations.length > 0 && (
                        <details className="mt-auto rounded-xl border border-line p-2 text-sm">
                          <summary className="cursor-pointer font-medium text-brand-700">Usar em uma conversa</summary>
                          <div className="pt-3">
                            <ActionForm action={sendAssetAction} submitLabel="Registrar envio (simulado)" success="Registrado na conversa.">
                              <input type="hidden" name="assetId" value={a.id} />
                              <Field label="Conversa" htmlFor={`conv-${a.id}`}>
                                <Select id={`conv-${a.id}`} name="conversationId" required>
                                  {conversations.map((c) => <option key={c.id} value={c.id}>{clients.get(c.clientId) ?? "Cliente"}</option>)}
                                </Select>
                              </Field>
                              <Field label="Legenda (opcional)" htmlFor={`cap-${a.id}`}><Input id={`cap-${a.id}`} name="caption" maxLength={1024} /></Field>
                            </ActionForm>
                          </div>
                        </details>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {manage && (
          <Card className={cn("xl:sticky xl:top-6 xl:self-start")}>
            <CardHeader title="Adicionar arquivo" description="Imagem até 10 MB · áudio e PDF até 16 MB · vídeo até 50 MB" />
            <div className="p-5">
              {!ready.ok ? (
                <p className="text-sm text-red-600">{ready.reason}</p>
              ) : (
                <UploadForm destino="biblioteca" accept={ACCEPT} submitLabel="Enviar para a biblioteca" success="Arquivo adicionado.">
                  <Field label="Título" htmlFor="title"><Input id="title" name="title" maxLength={160} placeholder="Ex.: Áudio de boas-vindas" /></Field>
                  <Field label="Etiquetas" htmlFor="tags" hint="Separadas por vírgula"><Input id="tags" name="tags" placeholder="portfólio, catálogo" /></Field>
                </UploadForm>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
