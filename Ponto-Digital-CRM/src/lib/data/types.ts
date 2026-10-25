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
}
