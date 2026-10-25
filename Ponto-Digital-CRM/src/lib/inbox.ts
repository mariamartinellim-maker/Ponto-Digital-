import type { SessionUser } from "./auth/session";
import type { Conversation } from "./data/types";
import { can } from "./permissions";

export const WINDOW_MS = 24 * 3600_000;

/** Atendentes veem apenas conversas atribuídas a eles ou sem responsável. */
export function canSeeConversation(user: Pick<SessionUser, "id" | "orgId" | "role">, conv: Conversation) {
  return conv.orgId === user.orgId && (can(user.role, "inbox:read_all") || conv.assigneeId === user.id || !conv.assigneeId);
}

/** Janela de atendimento da Meta: texto livre só até 24h após a última mensagem do cliente. */
export function windowOpen(conv: Conversation, now = Date.now()) {
  return !!conv.lastInboundAt && now - new Date(conv.lastInboundAt).getTime() <= WINDOW_MS;
}
