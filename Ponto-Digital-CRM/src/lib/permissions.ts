import type { Role } from "./data/types";

export const PERMISSIONS = {
  "dashboard:view": "Ver dashboard",
  "clients:read": "Ver clientes",
  "clients:write": "Cadastrar e editar clientes",
  "clients:delete": "Excluir / anonimizar clientes (LGPD)",
  "clients:import": "Importar contatos (CSV)",
  "clients:export": "Exportar dados de clientes",
  "deals:write": "Mover oportunidades no funil",
  "inbox:read_all": "Ver todas as conversas",
  "inbox:reply": "Responder conversas",
  "inbox:assign": "Transferir conversas",
  "quick_replies:manage": "Gerenciar respostas rápidas",
  "templates:manage": "Gerenciar modelos (templates)",
  "ai:use": "Pedir sugestões de resposta à IA",
  "ai:manage": "Editar a base de conhecimento da IA",
  "campaigns:read": "Ver campanhas",
  "campaigns:manage": "Criar e executar campanhas",
  "tasks:manage_all": "Gerenciar tarefas de toda a equipe",
  "users:manage": "Gerenciar usuários e permissões",
  "audit:read": "Ver registros de auditoria",
  "settings:manage": "Configurar integrações",
  "media:read": "Usar a biblioteca de mídias",
  "media:manage": "Enviar e excluir arquivos da biblioteca",
  "sales:manage": "Registrar vendas",
  "finance:manage": "Financeiro: confirmar comprovantes e lançamentos",
  "production:manage": "Atualizar ordens de produção",
  "guardian:manage": "Guardian: monitoramento, backups e recuperação",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  gestor: ALL.filter((p) => !["users:manage", "audit:read", "settings:manage", "clients:delete", "guardian:manage"].includes(p)),
  atendente: [
    "dashboard:view",
    "clients:read",
    "clients:write",
    "deals:write",
    "inbox:reply",
    "ai:use",
    "campaigns:read",
    "media:read",
    "sales:manage",
    "production:manage",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  atendente: "Atendente",
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
