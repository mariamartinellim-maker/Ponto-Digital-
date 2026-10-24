import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword, randomToken } from "../auth/password";
import { env } from "../env";
import type {
  Campaign,
  Client,
  Conversation,
  Database,
  Deal,
  Message,
  MessageOrigin,
  MessageTemplate,
  QuickReply,
  Stage,
  Task,
  TaskType,
  User,
} from "./types";

/** PRNG determinístico para que os dados demonstrativos sejam estáveis. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const CLIENTS: [string, string, string[], string][] = [
  ["Café Aroma Paulista", "São Paulo", ["Gestão de Redes Sociais", "Tráfego Pago"], "Cafeteria com 3 unidades. Foco em delivery."],
  ["Clínica Sorriso Pleno", "Campinas", ["Tráfego Pago", "Site / Landing Page"], "Quer captar pacientes para implantes."],
  ["Studio Bella Forma", "Santos", ["Gestão de Redes Sociais"], "Academia boutique. Prefere contato à tarde."],
  ["Ótica Visão Clara", "Sorocaba", ["Identidade Visual", "Gestão de Redes Sociais"], ""],
  ["Pet Shop Amigo Fiel", "São Paulo", ["Tráfego Pago"], "Campanhas sazonais (banho e tosa)."],
  ["Construtora Horizonte", "Ribeirão Preto", ["Site / Landing Page", "SEO", "Produção de Vídeo"], "Lançamento em março."],
  ["Doceria Flor de Açúcar", "Campinas", ["Gestão de Redes Sociais", "Produção de Vídeo"], ""],
  ["Advocacia Martins & Lopes", "São Paulo", ["SEO", "Site / Landing Page"], "Atenção às regras da OAB para publicidade."],
  ["Imobiliária Casa Nova", "Santos", ["Tráfego Pago", "Gestão de Redes Sociais"], ""],
  ["Escola de Idiomas Fluent", "Sorocaba", ["Tráfego Pago", "E-mail Marketing"], "Matrículas em janeiro e julho."],
  ["Restaurante Sabor Mineiro", "Belo Horizonte", ["Gestão de Redes Sociais"], ""],
  ["Auto Center Turbo", "Curitiba", ["Tráfego Pago"], "Orçamento mensal limitado."],
  ["Boutique Lírio", "São Paulo", ["Identidade Visual", "Gestão de Redes Sociais", "Produção de Vídeo"], ""],
  ["Clínica Vet Patinhas", "Campinas", ["Site / Landing Page"], ""],
  ["Hamburgueria Brasa", "Ribeirão Preto", ["Tráfego Pago", "Gestão de Redes Sociais"], "Quer aumentar pedidos no iFood."],
  ["Espaço Zen Yoga", "Santos", ["Gestão de Redes Sociais", "E-mail Marketing"], ""],
  ["Contabilidade Exata", "São Paulo", ["SEO", "Consultoria"], ""],
  ["Floricultura Primavera", "Curitiba", ["Gestão de Redes Sociais"], "Datas: Dia das Mães e Namorados."],
  ["Barbearia Navalha de Ouro", "Belo Horizonte", ["Tráfego Pago", "Produção de Vídeo"], ""],
  ["Laboratório Vida", "Sorocaba", ["Site / Landing Page", "SEO"], ""],
  ["Moda Fitness Ativa", "São Paulo", ["Tráfego Pago", "E-mail Marketing"], "E-commerce em Shopify."],
  ["Pousada Mar Azul", "Santos", ["Gestão de Redes Sociais", "Tráfego Pago"], ""],
  ["Padaria Pão Dourado", "Campinas", ["Gestão de Redes Sociais"], ""],
  ["Estética Renove", "Ribeirão Preto", ["Tráfego Pago", "Identidade Visual"], ""],
];

const DDD: Record<string, string> = {
  "São Paulo": "11", Campinas: "19", Santos: "13", Sorocaba: "15", "Ribeirão Preto": "16", "Belo Horizonte": "31", Curitiba: "41",
};

const DEAL_TITLES = [
  "Pacote mensal de redes sociais",
  "Campanha de tráfego pago — trimestre",
  "Novo site institucional",
  "Rebranding completo",
  "Vídeos para Reels (10 un.)",
  "Consultoria de posicionamento",
];

export async function buildSeed(): Promise<Database> {
  const e = env();
  const rand = rng(20251024);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
  const now = Date.now();
  const H = 3600_000;
  const D = 24 * H;
  const iso = (t: number) => new Date(t).toISOString();

  const orgId = randomUUID();
  // Nenhuma senha fica no código: vêm do .env.local (gerado por `npm run setup`).
  const adminPw = e.DEMO_ADMIN_PASSWORD ?? randomToken(18);
  const teamPw = e.DEMO_TEAM_PASSWORD ?? randomToken(18);
  const mkUser = async (name: string, email: string, role: User["role"], pw: string): Promise<User> => ({
    id: randomUUID(),
    orgId,
    name,
    email,
    role,
    passwordHash: await hashPassword(pw),
    active: true,
    sessionVersion: 1,
    createdAt: iso(now - 120 * D),
    lastLoginAt: null,
  });
  const users = [
    await mkUser("Administrador(a) Ponto Digital", e.DEMO_ADMIN_EMAIL.toLowerCase(), "admin", adminPw),
    await mkUser("Lucas Ferreira", "lucas@pontodigital.demo", "gestor", teamPw),
    await mkUser("Ana Souza", "ana@pontodigital.demo", "atendente", teamPw),
    await mkUser("Pedro Lima", "pedro@pontodigital.demo", "atendente", teamPw),
  ];
  const team = users.slice(1);

  const clients: Client[] = CLIENTS.map(([name, city, services, notes], i) => {
    const createdAt = now - Math.floor(rand() * 150) * D - 2 * D;
    const consentRoll = rand();
    const status = consentRoll < 0.72 ? "opt_in" : consentRoll < 0.85 ? "opt_out" : "desconhecido";
    return {
      id: randomUUID(),
      orgId,
      name,
      // Números fictícios (faixa 11 90000-xxxx) — envios são sempre simulados nesta versão.
      phone: `55${DDD[city] ?? "11"}90000${String(1000 + i).slice(-4)}`,
      email: `contato@${name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").slice(0, 14)}.demo`,
      city,
      services,
      tags: rand() > 0.6 ? ["VIP"] : rand() > 0.5 ? ["Indicação"] : [],
      notes,
      ownerId: pick(team).id,
      consent:
        status === "desconhecido"
          ? { status, source: null, at: null }
          : { status, source: pick(["formulario", "whatsapp", "manual"] as const), at: iso(createdAt + D) },
      createdAt: iso(createdAt),
      updatedAt: iso(createdAt + 3 * D),
      lastContactAt: null,
    };
  });

  const consentEvents = clients
    .filter((c) => c.consent.status !== "desconhecido")
    .map((c) => ({
      id: randomUUID(),
      orgId,
      clientId: c.id,
      status: c.consent.status as "opt_in" | "opt_out",
      source: c.consent.source!,
      note: c.consent.status === "opt_in" ? "Aceitou receber novidades pelo WhatsApp." : "Pediu para não receber campanhas.",
      byUserId: null,
      at: c.consent.at!,
    }));

  // Oportunidades no funil, incluindo vendas fechadas nos últimos 6 meses para o gráfico.
  const stageWeights: Stage[] = [
    "novo_lead", "novo_lead", "novo_lead", "novo_lead",
    "em_atendimento", "em_atendimento", "em_atendimento", "em_atendimento",
    "proposta_enviada", "proposta_enviada", "proposta_enviada",
    "fechado", "fechado", "fechado", "fechado", "fechado", "fechado", "fechado", "fechado", "fechado",
    "perdido", "perdido",
  ];
  const deals: Deal[] = [];
  let closedCount = 0;
  clients.forEach((c, i) => {
    const n = i % 3 === 0 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const stage = stageWeights[(i * 7 + k * 5) % stageWeights.length]!;
      let created = new Date(c.createdAt).getTime() + k * 10 * D;
      let closedAt: number | null = null;
      if (stage === "fechado" || stage === "perdido") {
        // Distribui os fechamentos pelos últimos 6 meses (inclusive o mês atual).
        const ref = new Date(now);
        const monthsAgo = closedCount++ % 6;
        closedAt = new Date(ref.getFullYear(), ref.getMonth() - monthsAgo, 1 + Math.floor(rand() * 27), 11).getTime();
        if (closedAt > now - H) closedAt = now - Math.floor(1 + rand() * 20) * H;
        created = Math.min(created, closedAt - (7 + Math.floor(rand() * 20)) * D);
      }
      deals.push({
        id: randomUUID(),
        orgId,
        clientId: c.id,
        title: pick(DEAL_TITLES),
        valueCents: Math.round((1500 + rand() * 9000) / 50) * 50 * 100,
        stage,
        ownerId: c.ownerId,
        createdAt: iso(created),
        updatedAt: iso(closedAt ?? created + 2 * D),
        closedAt: closedAt ? iso(closedAt) : null,
      });
    }
  });

  // Conversas — inclui mensagens enviadas pelo App WhatsApp Business (coexistência) e histórico sincronizado.
  const scripts: [MessageOrigin, "in" | "out", string][][] = [
    [
      ["cliente", "in", "Oi! Vi o anúncio de vocês no Instagram. Vocês fazem gestão de redes para cafeteria?"],
      ["crm", "out", "Olá! Fazemos sim 😊 Sou da Ponto Digital. Posso te fazer algumas perguntas rápidas sobre o seu negócio?"],
      ["cliente", "in", "Pode sim! Temos 3 lojas e queremos aumentar o delivery."],
    ],
    [
      ["historico", "in", "Bom dia, gostaria de um orçamento para site."],
      ["historico", "out", "Bom dia! Claro, vou te enviar nosso portfólio."],
      ["app_business", "out", "Segue a proposta em PDF que comentei por telefone."],
      ["cliente", "in", "Recebi, obrigada! Vou analisar com meu sócio e retorno até sexta."],
    ],
    [
      ["cliente", "in", "Qual o valor do pacote mensal?"],
      ["crm", "out", "Nossos pacotes começam em R$ 1.800/mês. Posso agendar uma conversa de 15 min para entender sua necessidade?"],
    ],
    [
      ["campanha", "out", "Olá, Ótica Visão Clara! A Ponto Digital preparou um diagnóstico gratuito do seu Instagram. Quer receber? Responda SAIR para não receber mais mensagens."],
      ["cliente", "in", "Quero sim!"],
    ],
    [
      ["cliente", "in", "Vocês conseguem fazer uma campanha para o Dia dos Pais?"],
      ["app_business", "out", "Conseguimos! Te ligo em 10 minutos para alinhar."],
      ["crm", "out", "Conforme conversamos, segue o cronograma da campanha."],
      ["cliente", "in", "Perfeito, aprovado 👏"],
    ],
    [
      ["cliente", "in", "Preciso remarcar a reunião de amanhã, pode ser quinta?"],
    ],
    [
      ["crm", "out", "Oi! Passando para lembrar da nossa reunião hoje às 15h."],
      ["cliente", "in", "Confirmado!"],
    ],
    [
      ["cliente", "in", "Os anúncios pararam de rodar, aconteceu algo?"],
      ["crm", "out", "Vou verificar agora mesmo no gerenciador e já te retorno."],
      ["crm", "out", "Era o limite do cartão. Já ajustamos e a campanha voltou ao ar ✅"],
    ],
    [
      ["historico", "in", "Vocês fazem vídeos para Reels?"],
      ["historico", "out", "Fazemos! Temos pacotes de 4, 8 e 10 vídeos."],
    ],
    [
      ["cliente", "in", "Boa tarde! Quero entender melhor o serviço de SEO."],
    ],
  ];
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  scripts.forEach((script, i) => {
    const client = clients[i]!;
    const convId = randomUUID();
    const end = now - (i < 4 ? i * 3 * H + 25 * 60_000 : (i - 2) * D + 4 * H);
    // Calcula os horários de trás para frente a partir da última mensagem.
    const times: number[] = [];
    let t = end;
    for (let j = script.length - 1; j >= 0; j--) {
      times[j] = t;
      t -= script[j]![0] === "historico" ? 3 * D : 9 * 60_000;
    }
    let lastIn: number | null = null;
    script.forEach(([origin, direction, body], j) => {
      t = times[j]!;
      if (direction === "in") lastIn = t;
      messages.push({
        id: randomUUID(),
        orgId,
        conversationId: convId,
        direction,
        origin,
        body,
        status: direction === "in" ? "recebida" : j === script.length - 1 ? "entregue" : "lida",
        waMessageId: `wamid.DEMO${i}${j}`,
        authorId: origin === "crm" ? client.ownerId : null,
        createdAt: iso(t),
      });
    });
    t = end;
    const last = script[script.length - 1]!;
    conversations.push({
      id: convId,
      orgId,
      clientId: client.id,
      assigneeId: i === 5 || i === 9 ? null : client.ownerId,
      status: i === 6 ? "resolvida" : i === 2 ? "pendente" : "aberta",
      unread: last[1] === "in" && i !== 6 ? 1 + (i % 2) : 0,
      lastMessageAt: iso(t),
      lastInboundAt: lastIn ? iso(lastIn) : null,
    });
    client.lastContactAt = iso(t);
  });

  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const quickReplies: QuickReply[] = [
    { shortcut: "ola", title: "Saudação", body: "Olá! Aqui é da Ponto Digital 👋 Como podemos ajudar o seu negócio hoje?" },
    { shortcut: "horario", title: "Horário de atendimento", body: "Nosso atendimento é de segunda a sexta, das 9h às 18h. Retornaremos o quanto antes!" },
    { shortcut: "portfolio", title: "Portfólio", body: "Você pode conhecer nossos cases em pontodigital.com.br/portfolio. Quer que eu envie alguns exemplos do seu segmento?" },
    { shortcut: "reuniao", title: "Agendar reunião", body: "Que tal uma conversa de 15 minutos para entendermos seus objetivos? Qual o melhor dia e horário para você?" },
    { shortcut: "proposta", title: "Envio de proposta", body: "Preparei sua proposta personalizada. Qualquer dúvida, estou à disposição para explicar cada item." },
    { shortcut: "obrigado", title: "Agradecimento", body: "Obrigado pela confiança! Seguimos juntos para fazer sua marca crescer 🚀" },
  ].map((q) => ({ ...q, id: randomUUID(), orgId }));

  const SAIR = "\n\nResponda SAIR para não receber mais mensagens.";
  const templates: MessageTemplate[] = (
    [
      ["boas_vindas", "UTILITY", "Olá, {{1}}! Obrigado por falar com a Ponto Digital. Em breve um especialista vai te atender.", "APPROVED"],
      ["diagnostico_gratuito", "MARKETING", "Olá, {{1}}! A Ponto Digital preparou um diagnóstico gratuito das redes sociais da sua empresa. Quer receber?" + SAIR, "APPROVED"],
      ["lembrete_reuniao", "UTILITY", "Olá, {{1}}! Lembrete da nossa reunião em {{2}}. Até lá!", "APPROVED"],
      ["black_friday", "MARKETING", "{{1}}, a Black Friday está chegando! Garanta 20% de desconto no plano trimestral de tráfego pago." + SAIR, "PENDING"],
      ["pesquisa_satisfacao", "MARKETING", "Oi {{1}}, de 0 a 10, quanto você recomendaria a Ponto Digital?", "REJECTED"],
    ] as const
  ).map(([name, category, body, status], i) => ({
    id: randomUUID(),
    orgId,
    name,
    category,
    language: "pt_BR",
    body,
    status,
    metaTemplateId: null,
    createdAt: iso(now - (60 - i * 7) * D),
  }));

  // Campanha simulada já concluída, para demonstrar o acompanhamento de resultados.
  const optedIn = clients.filter((c) => c.consent.status === "opt_in");
  const statuses = ["lida", "lida", "lida", "entregue", "entregue", "respondeu", "respondeu", "falhou", "descadastrou", "lida"] as const;
  const campaigns: Campaign[] = [
    {
      id: randomUUID(),
      orgId,
      name: "Diagnóstico gratuito — Outubro",
      templateId: templates[1]!.id,
      segment: { cities: [], services: ["Gestão de Redes Sociais"], stages: [], tags: [] },
      mode: "simulacao",
      status: "concluida",
      createdBy: users[1]!.id,
      createdAt: iso(now - 9 * D),
      executedAt: iso(now - 8 * D),
      excludedNoConsent: clients.filter((c) => c.services.includes("Gestão de Redes Sociais") && c.consent.status === "desconhecido").length,
      excludedOptOut: clients.filter((c) => c.services.includes("Gestão de Redes Sociais") && c.consent.status === "opt_out").length,
      recipients: optedIn
        .filter((c) => c.services.includes("Gestão de Redes Sociais"))
        .map((c, i) => ({ clientId: c.id, status: statuses[i % statuses.length]!, waMessageId: null })),
    },
    {
      id: randomUUID(),
      orgId,
      name: "Lembrete de reuniões — Campinas",
      templateId: templates[2]!.id,
      segment: { cities: ["Campinas"], services: [], stages: [], tags: [] },
      mode: "simulacao",
      status: "rascunho",
      createdBy: users[0]!.id,
      createdAt: iso(now - D),
      executedAt: null,
      excludedNoConsent: 0,
      excludedOptOut: 0,
      recipients: [],
    },
  ];

  const taskDefs: [string, TaskType, number][] = [
    ["Retornar sobre proposta de site", "retorno", -2 * D],
    ["Ligar para alinhar campanha de Dia dos Pais", "ligacao", -5 * H],
    ["Enviar relatório mensal de resultados", "outro", 2 * H],
    ["Reunião de briefing — rebranding", "reuniao", 5 * H],
    ["Follow-up: orçamento de vídeos", "retorno", 1 * D + 3 * H],
    ["Apresentar proposta de SEO", "proposta", 2 * D],
    ["Retorno sobre remarcação da reunião", "retorno", 3 * H],
    ["Ligação de boas-vindas (novo cliente)", "ligacao", 3 * D],
    ["Revisar criativos da campanha", "outro", 4 * D],
    ["Reunião mensal de performance", "reuniao", 6 * D],
    ["Confirmar pagamento da primeira mensalidade", "retorno", -1 * D],
  ];
  const tasks: Task[] = taskDefs.map(([title, type, offset], i) => ({
    id: randomUUID(),
    orgId,
    title,
    type,
    clientId: clients[i]!.id,
    assigneeId: team[i % team.length]!.id,
    dueAt: iso(now + offset),
    done: i === 10,
    notes: "",
    createdAt: iso(now - 3 * D),
  }));

  return {
    version: 1,
    organizations: [{ id: orgId, name: "Ponto Digital", createdAt: iso(now - 365 * D) }],
    users,
    clients,
    consentEvents,
    deals,
    conversations,
    messages,
    quickReplies,
    templates,
    campaigns,
    tasks,
    auditLogs: [
      {
        id: randomUUID(),
        orgId,
        userId: null,
        action: "sistema.seed",
        entity: "sistema",
        entityId: null,
        details: "Base demonstrativa criada.",
        ip: null,
        at: iso(now),
      },
    ],
    passwordResets: [],
    webhookEvents: [],
    processedWaIds: [],
  };
}
