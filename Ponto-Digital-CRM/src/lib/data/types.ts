export type Role = "admin" | "gestor" | "atendente";

export const STAGES = [
  { id: "novo_lead", label: "Novo Lead" },
  { id: "em_atendimento", label: "Em Atendimento" },
  { id: "proposta_enviada", label: "Proposta Enviada" },
  { id: "fechado", label: "Fechado" },
  { id: "perdido", label: "Perdido" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

export const SERVICES = [
  "Gestão de Redes Sociais",
  "Tráfego Pago",
  "Identidade Visual",
  "Site / Landing Page",
  "SEO",
  "Produção de Vídeo",
  "Consultoria",
  "E-mail Marketing",
] as const;

export type ConsentStatus = "opt_in" | "opt_out" | "desconhecido";
export type ConsentSource = "formulario" | "whatsapp" | "importacao" | "manual" | "palavra_chave" | "campanha";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  /** Incrementado ao trocar senha/desativar: invalida sessões antigas. */
  sessionVersion: number;
  /** Participa do rodízio de novos atendimentos do WhatsApp. */
  inRotation?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
export type PublicUser = Omit<User, "passwordHash" | "sessionVersion">;

export interface Consent {
  status: ConsentStatus;
  source: ConsentSource | null;
  at: string | null;
}

export interface Client {
  id: string;
  orgId: string;
  name: string;
  /** Telefone normalizado em formato E.164 sem "+" (ex.: 5511999990000). */
  phone: string;
  email: string;
  city: string;
  services: string[];
  tags: string[];
  notes: string;
  ownerId: string | null;
  consent: Consent;
  createdAt: string;
  updatedAt: string;
  lastContactAt: string | null;
}

export interface ConsentEvent {
  id: string;
  orgId: string;
  clientId: string;
  status: Exclude<ConsentStatus, "desconhecido">;
  source: ConsentSource;
  note: string;
  byUserId: string | null;
  at: string;
}

export interface Deal {
  id: string;
  orgId: string;
  clientId: string;
  title: string;
  valueCents: number;
  stage: Stage;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export type ConversationStatus = "aberta" | "pendente" | "resolvida";
export interface Conversation {
  id: string;
  orgId: string;
  clientId: string;
  assigneeId: string | null;
  status: ConversationStatus;
  unread: number;
  lastMessageAt: string;
  /** Última mensagem recebida do cliente — define a janela de 24h da Meta. */
  lastInboundAt: string | null;
}

/** De onde veio a mensagem: importante na coexistência App Business + Cloud API. */
export type MessageOrigin = "cliente" | "crm" | "app_business" | "campanha" | "historico" | "sistema";
export type MessageStatus = "recebida" | "simulada" | "enviada" | "entregue" | "lida" | "falhou";
/** Mídia de uma mensagem: o arquivo fica na Meta e é baixado sob demanda pelo CRM. */
export interface MessageMedia {
  type: "image" | "audio" | "video" | "document" | "sticker";
  id?: string;
  mime?: string;
  filename?: string;
  caption?: string;
  voice?: boolean;
  /** Envio simulado: o arquivo não foi enviado à Meta. */
  simulated?: boolean;
  /** Arquivo guardado na biblioteca do CRM (mídias do WhatsApp Web e envios a partir da biblioteca). */
  assetId?: string;
}
export interface Message {
  id: string;
  orgId: string;
  conversationId: string;
  direction: "in" | "out";
  origin: MessageOrigin;
  body: string;
  status: MessageStatus;
  waMessageId: string | null;
  authorId: string | null;
  createdAt: string;
  media?: MessageMedia | null;
  /** Texto escrito a partir de uma sugestão da IA (revisada e enviada por um humano). */
  aiAssisted?: boolean;
  /** Motivo da falha de entrega informado pela Meta. */
  error?: string | null;
}

export interface QuickReply {
  id: string;
  orgId: string;
  shortcut: string;
  title: string;
  body: string;
}

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED";
export interface MessageTemplate {
  id: string;
  orgId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  status: TemplateStatus;
  /** Preenchido quando sincronizado com a Meta. */
  metaTemplateId: string | null;
  createdAt: string;
}

export interface Segment {
  cities: string[];
  services: string[];
  stages: Stage[];
  tags: string[];
}

export type CampaignStatus = "rascunho" | "concluida" | "cancelada";
export type RecipientStatus = "simulada" | "enviada" | "entregue" | "lida" | "falhou" | "respondeu" | "descadastrou";
export interface CampaignRecipient {
  clientId: string;
  status: RecipientStatus;
  waMessageId: string | null;
}
export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  templateId: string;
  segment: Segment;
  /** Sempre "simulacao" nesta versão: nenhuma campanha real é enviada. */
  mode: "simulacao" | "live";
  status: CampaignStatus;
  createdBy: string;
  createdAt: string;
  executedAt: string | null;
  excludedNoConsent: number;
  excludedOptOut: number;
  recipients: CampaignRecipient[];
}

export type TaskType = "retorno" | "ligacao" | "reuniao" | "proposta" | "outro";
export interface Task {
  id: string;
  orgId: string;
  title: string;
  type: TaskType;
  clientId: string | null;
  assigneeId: string | null;
  dueAt: string;
  done: boolean;
  notes: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: string;
  ip: string | null;
  at: string;
}

export interface PasswordReset {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface WebhookEventLog {
  id: string;
  orgId: string;
  field: string;
  summary: string;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Módulos operacionais: biblioteca, comprovantes, vendas, financeiro, produção, Guardian, IA (demo)
// ---------------------------------------------------------------------------
export type AssetType = "image" | "audio" | "video" | "document";
export type AssetSource = "upload" | "whatsapp_web" | "whatsapp";
export interface MediaAsset {
  id: string;
  orgId: string;
  title: string;
  type: AssetType;
  mime: string;
  size: number;
  filename: string;
  tags: string[];
  source: AssetSource;
  clientId: string | null;
  /** Caminho do arquivo no armazenamento (disco local no modo demo, Supabase Storage no publicado). */
  storageKey: string;
  createdBy: string | null;
  createdAt: string;
}

export type ReceiptStatus = "pendente" | "confirmado" | "rejeitado" | "duplicado";
export type PaymentMethod = "pix" | "boleto" | "ted" | "cartao" | "dinheiro" | "outro";
export interface ReceiptData {
  valorCentavos: number | null;
  dataPagamento: string | null;
  pagador: string | null;
  recebedor: string | null;
  banco: string | null;
  metodo: PaymentMethod | null;
  idTransacao: string | null;
  confianca: number;
  observacao: string;
}
export interface Receipt {
  id: string;
  orgId: string;
  mediaId: string;
  clientId: string | null;
  saleId: string | null;
  status: ReceiptStatus;
  data: ReceiptData | null;
  /** "ia" = Claude, "simulador" = sem chave (testes), "manual" = digitado. */
  analyzer: "ia" | "simulador" | "manual" | "pendente";
  analysisError: string | null;
  duplicateOf: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type SaleStatus = "aguardando_pagamento" | "pago" | "cancelada";
export interface SaleItem {
  description: string;
  quantity: number;
  unitCents: number;
}
export interface Sale {
  id: string;
  orgId: string;
  number: number;
  clientId: string;
  dealId: string | null;
  conversationId: string | null;
  items: SaleItem[];
  totalCents: number;
  status: SaleStatus;
  paymentMethod: PaymentMethod;
  dueDate: string | null;
  paidAt: string | null;
  receiptId: string | null;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FinanceKind = "entrada" | "saida";
export interface FinanceEntry {
  id: string;
  orgId: string;
  kind: FinanceKind;
  category: string;
  description: string;
  amountCents: number;
  date: string;
  saleId: string | null;
  receiptId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type ProductionStage = "fila" | "producao" | "revisao" | "entregue" | "cancelada";
export interface ProductionOrder {
  id: string;
  orgId: string;
  number: number;
  saleId: string | null;
  clientId: string;
  title: string;
  checklist: { description: string; done: boolean }[];
  stage: ProductionStage;
  assigneeId: string | null;
  dueDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export type GuardianLevel = "info" | "aviso" | "erro";
export interface GuardianEvent {
  id: string;
  orgId: string | null;
  level: GuardianLevel;
  source: string;
  message: string;
  at: string;
}

export interface AiKnowledgeRecord {
  orgId: string;
  enabled: boolean;
  about: string;
  services: string;
  prices: string;
  portfolio: string;
  tone: string;
  faq: string;
  rules: string;
  updatedBy: string | null;
  updatedAt: string;
}
export interface AiSuggestionRecord {
  id: string;
  orgId: string;
  conversationId: string;
  createdBy: string;
  model: string;
  suggestion: string;
  needsHuman: boolean;
  reason: string;
  status: "sugerida" | "usada" | "descartada";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  createdAt: string;
}

/**
 * Pedido de vídeo com avatar (todos os segmentos de motorista): foto do cliente → avatar → vídeo → prévia com marca d'água →
 * comprovante → vídeo limpo. Cada etapa paga (avatar e vídeo) só roda com a automação ligada e dentro do limite do mês.
 */
export type VideoOrderStatus =
  | "foto_recebida"
  | "gerando_avatar"
  | "avatar_pronto"
  | "avatar_enviado"
  | "gerando_video"
  | "video_pronto"
  | "aguardando_pagamento"
  | "pago"
  | "entregue"
  | "falhou"
  | "cancelado";
/** Segmento do motorista: o vídeo (cena, logo final e fala) se adapta a cada um. */
export type VideoModality = "uber" | "taxi" | "mototaxi" | "motoboy" | "executivo" | "van" | "frete" | "particular";
export interface VideoOrder {
  id: string;
  orgId: string;
  number: number;
  clientId: string;
  conversationId: string | null;
  modality: VideoModality;
  /** Nome da "empresa" no vídeo: nome e modalidade do motorista (ex.: "Benner Táxi", "Motorista RJ"). */
  driverName: string;
  /** Define "o motorista"/"a motorista" no prompt e a voz do vídeo. */
  driverGender: "masculino" | "feminino";
  /** Cidade do cliente: paisagem nas janelas. */
  city: string;
  /** Fala do avatar no vídeo. */
  speech: string;
  /** WhatsApp que aparece no vídeo para os passageiros chamarem o motorista. */
  contactPhone: string;
  /** Ajustes pedidos pelo cliente (refazer avatar ou vídeo). */
  adjustments: string;
  status: VideoOrderStatus;
  photoAssetId: string;
  avatarAssetId: string | null;
  videoAssetId: string | null;
  previewAssetId: string | null;
  receiptAssetId: string | null;
  /** Quantas vezes cada etapa paga rodou (controle de gasto). */
  avatarRuns: number;
  videoRuns: number;
  /** "simulador" = sem chave (teste gratuito, sem IA); "ia" = OpenAI + Veo. */
  engine: "simulador" | "ia";
  /** Conduzido pelo atendimento automático: avatar e prévia são enviados sozinhos ao ficarem prontos. */
  autopilot: boolean;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  avatarSentAt: string | null;
  previewSentAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
}

/** Atendimento automático dos vídeos: configuração da organização. */
export interface VideoAutopilotSettings {
  id: string;
  orgId: string;
  enabled: boolean;
  /** "anuncio": só contato novo vindo de anúncio; "contato_novo": qualquer contato novo. */
  trigger: "anuncio" | "contato_novo";
  /** Responde só aos números de teste (WHATSAPP_NUMEROS_TESTE). */
  testOnly: boolean;
  priceText: string;
  pixKey: string;
  /** Titular e cidade da chave (cartão de cobrança Pix). */
  pixHolder: string;
  pixCity: string;
  /** Áudio gravado de boas-vindas, perguntando o segmento do motorista. */
  audioAskAssetId: string | null;
  /** Áudio gravado: "Vamos precisar apenas de uma foto sua e das informações do seu atendimento." */
  audioPhotoAssetId: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export type AutopilotStage = "perguntou_modalidade" | "pediu_foto" | "roteiro" | "avatar" | "video" | "finalizado" | "humano";
/** Andamento do atendimento automático numa conversa. */
export interface VideoAutopilotState {
  id: string;
  orgId: string;
  conversationId: string;
  clientId: string;
  stage: AutopilotStage;
  modality: VideoModality | null;
  /** Informações do atendimento que o cliente escreveu (base da fala e do nome no vídeo). */
  info: string;
  photoAssetId: string | null;
  /** Roteiro enviado ao cliente para aprovar antes do avatar. */
  draft: { driverName: string; driverGender: "masculino" | "feminino"; city: string; speech: string; contactPhone: string } | null;
  orderId: string | null;
  /** Respostas que o robô não entendeu: na terceira, passa para uma pessoa. */
  retries: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Database {
  version: number;
  organizations: Organization[];
  users: User[];
  clients: Client[];
  consentEvents: ConsentEvent[];
  deals: Deal[];
  conversations: Conversation[];
  messages: Message[];
  quickReplies: QuickReply[];
  templates: MessageTemplate[];
  campaigns: Campaign[];
  tasks: Task[];
  auditLogs: AuditLog[];
  passwordResets: PasswordReset[];
  webhookEvents: WebhookEventLog[];
  /** IDs de mensagens WhatsApp já processadas (idempotência de webhooks). */
  processedWaIds: string[];
  mediaAssets: MediaAsset[];
  receipts: Receipt[];
  sales: Sale[];
  financeEntries: FinanceEntry[];
  productionOrders: ProductionOrder[];
  guardianEvents: GuardianEvent[];
  aiKnowledge: AiKnowledgeRecord[];
  aiSuggestions: AiSuggestionRecord[];
  videoOrders: VideoOrder[];
  videoAutopilotSettings: VideoAutopilotSettings[];
  videoAutopilotStates: VideoAutopilotState[];
}

/** Coleções acrescentadas depois da versão 1 da base demo (criadas vazias em bases antigas). */
export const LATER_COLLECTIONS = ["mediaAssets", "receipts", "sales", "financeEntries", "productionOrders", "guardianEvents", "aiKnowledge", "aiSuggestions", "videoOrders", "videoAutopilotSettings", "videoAutopilotStates"] as const;
