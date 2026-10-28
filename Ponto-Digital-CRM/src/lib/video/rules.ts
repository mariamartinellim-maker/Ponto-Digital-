import type { VideoModality, VideoOrder, VideoOrderStatus } from "../data/types";

/* Regras puras dos vídeos com avatar (sem banco nem APIs): etapas, limites e prompts. Testáveis isoladamente. */

export const VIDEO_STATUS: Record<VideoOrderStatus, { label: string; tone: "slate" | "amber" | "sky" | "green" | "red" }> = {
  foto_recebida: { label: "Foto recebida", tone: "slate" },
  gerando_avatar: { label: "Gerando avatar…", tone: "sky" },
  avatar_pronto: { label: "Avatar pronto", tone: "amber" },
  avatar_enviado: { label: "Avatar enviado · aguardando o cliente aprovar", tone: "amber" },
  gerando_video: { label: "Gerando vídeo…", tone: "sky" },
  video_pronto: { label: "Vídeo pronto", tone: "amber" },
  aguardando_pagamento: { label: "Prévia enviada · aguardando pagamento", tone: "amber" },
  pago: { label: "Pago", tone: "green" },
  entregue: { label: "Entregue", tone: "green" },
  falhou: { label: "Falhou", tone: "red" },
  cancelado: { label: "Cancelado", tone: "slate" },
};

type Vehicle = "carro" | "van" | "moto" | "cabine";
/** Segmentos atendidos: cena do avatar, texto da logo final e nome padrão de cada um. */
export const SEGMENTS: Record<VideoModality, { label: string; subtitle: string; suffix: string; vehicle: Vehicle; scene: string; speech: string }> = {
  uber: { label: "Aplicativo (Uber, 99…)", subtitle: "MOTORISTA DE APLICATIVO", suffix: "Motorista", vehicle: "carro", scene: "", speech: "Precisando de uma corrida? Viagem segura, carro confortável e pontualidade. Me chama no WhatsApp!" },
  taxi: { label: "Táxi", subtitle: "TÁXI", suffix: "Táxi", vehicle: "carro", scene: " O carro é um táxi.", speech: "Precisando de táxi? Atendimento rápido, seguro e com conforto. Me chama no WhatsApp!" },
  mototaxi: { label: "Mototáxi", subtitle: "MOTOTÁXI", suffix: "Mototáxi", vehicle: "moto", scene: " Passageiro na garupa, de capacete, sorrindo. O piloto usa colete de mototaxista.", speech: "Precisando chegar rápido? Mototáxi com segurança, capacete pro passageiro e preço justo. Me chama no WhatsApp!" },
  motoboy: { label: "Motoboy / entregas", subtitle: "MOTOBOY · ENTREGAS", suffix: "Motoboy", vehicle: "moto", scene: " Moto com baú de entregas na traseira, sem passageiro.", speech: "Precisa entregar alguma coisa? Entrega rápida, com cuidado e no horário. Me chama no WhatsApp!" },
  executivo: { label: "Motorista executivo", subtitle: "MOTORISTA EXECUTIVO", suffix: "Executivo", vehicle: "carro", scene: " Carro sedã preto executivo; motorista bem vestido, de camisa social e paletó.", speech: "Transporte executivo com conforto, discrição e pontualidade. Me chama no WhatsApp e agende!" },
  van: { label: "Van / transporte escolar", subtitle: "TRANSPORTE EM VAN", suffix: "Transportes", vehicle: "van", scene: "", speech: "Transporte em van com segurança, conforto e pontualidade. Me chama no WhatsApp!" },
  frete: { label: "Frete / carreto", subtitle: "FRETES E CARRETOS", suffix: "Fretes", vehicle: "cabine", scene: "", speech: "Precisando de frete ou mudança? Carga bem cuidada, rapidez e preço justo. Me chama no WhatsApp!" },
  particular: { label: "Motorista particular / outro", subtitle: "MOTORISTA PARTICULAR", suffix: "Motorista", vehicle: "carro", scene: "", speech: "Precisando de motorista? Viagem segura, carro confortável e pontualidade. Me chama no WhatsApp!" },
};
export const MODALITIES = Object.keys(SEGMENTS) as VideoModality[];
export const isModality = (v: string): v is VideoModality => Object.hasOwn(SEGMENTS, v);
export const MODALITY_LABEL = Object.fromEntries(MODALITIES.map((m) => [m, SEGMENTS[m].label])) as Record<VideoModality, string>;

/** Colunas do quadro, na ordem do fluxo. */
export const VIDEO_COLUMNS: { id: string; label: string; statuses: VideoOrderStatus[] }[] = [
  { id: "avatar", label: "Avatar", statuses: ["foto_recebida", "gerando_avatar", "avatar_pronto", "avatar_enviado"] },
  { id: "video", label: "Vídeo", statuses: ["gerando_video", "video_pronto"] },
  { id: "pagamento", label: "Aguardando pagamento", statuses: ["aguardando_pagamento", "pago"] },
  { id: "problema", label: "Com problema", statuses: ["falhou"] },
];

export type VideoAction = "gerar_avatar" | "enviar_avatar" | "gerar_video" | "enviar_previa" | "confirmar_pagamento" | "enviar_final" | "cancelar";

/** Ações possíveis em cada etapa. Refazer avatar/vídeo = rodar a mesma ação de novo (com ajustes). */
export function allowedActions(o: Pick<VideoOrder, "status" | "avatarAssetId" | "videoAssetId" | "previewAssetId">): VideoAction[] {
  switch (o.status) {
    case "foto_recebida":
      return ["gerar_avatar", "cancelar"];
    case "avatar_pronto":
      return ["enviar_avatar", "gerar_avatar", "gerar_video", "cancelar"];
    case "avatar_enviado":
      // Cliente pediu ajuste → refaz o avatar; aprovou ("pode continuar") → gera o vídeo.
      return ["gerar_avatar", "gerar_video", "enviar_avatar", "cancelar"];
    case "video_pronto":
      return ["gerar_avatar", "gerar_video", "enviar_previa", "cancelar"];
    case "aguardando_pagamento":
      return ["gerar_video", "enviar_previa", "confirmar_pagamento", "cancelar"];
    case "pago":
      return ["enviar_final"];
    case "falhou":
      // Volta para a última etapa concluída.
      return [...(o.videoAssetId ? (["gerar_video", "enviar_previa"] as const) : o.avatarAssetId ? (["gerar_avatar", "gerar_video"] as const) : (["gerar_avatar"] as const)), "cancelar"];
    default:
      return [];
  }
}

export const canDo = (o: Parameters<typeof allowedActions>[0], a: VideoAction) => allowedActions(o).includes(a);

/** Início do mês corrente no horário de Cuiabá (UTC-4), em ISO: base do limite mensal de gastos. */
export function monthStartCuiaba(now = new Date()): string {
  const local = new Date(now.getTime() - 4 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 4)).toISOString();
}

/** Limite de gasto: cada avatar ou vídeo gerado pela IA conta 1 geração. */
export function paidRunsLeft(usedThisMonth: number, monthlyLimit: number) {
  return Math.max(0, monthlyLimit - usedThisMonth);
}

/** Texto curto e seguro para ir dentro de um prompt (sem quebras de linha nem aspas que confundam o modelo). */
export function promptText(s: string, max: number) {
  return s.replace(/[\r\n\t]+/g, " ").replace(/["“”]/g, "'").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

/** "65999990000" → "(65) 99999-0000". Mantém o texto como veio se não for um número brasileiro. */
export function formatBrPhone(raw: string) {
  const d = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw.trim();
}

export const MAX_SPEECH_WORDS = 30;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function validateOrderInput(i: { driverName: string; speech: string; contactPhone: string; modality: string; driverGender?: string }): string | null {
  if (!promptText(i.driverName, 80)) return "Informe o nome que aparece no vídeo (ex.: \"Benner Táxi\" ou \"Motorista RJ\").";
  if (!promptText(i.speech, 400)) return "Informe a fala do motorista.";
  if (i.speech.length > 400 || wordCount(i.speech) > MAX_SPEECH_WORDS) return `A fala pode ter até ${MAX_SPEECH_WORDS} palavras (o vídeo tem 8 s de fala).`;
  if (!isModality(i.modality)) return "Escolha o segmento do motorista.";
  if (i.driverGender && i.driverGender !== "masculino" && i.driverGender !== "feminino") return "Escolha motorista homem ou mulher.";
  if (i.contactPhone && i.contactPhone.replace(/\D/g, "").length < 10) return "WhatsApp do vídeo inválido (use DDD + número).";
  return null;
}

type PromptOrder = Pick<VideoOrder, "modality" | "driverName" | "driverGender" | "city" | "speech" | "adjustments">;

function avatarScene(m: VideoModality, who: string): string[] {
  const seg = SEGMENTS[m];
  if (seg.vehicle === "moto") {
    return [
      "Crie uma imagem fotorrealista no formato vertical 1080x1920 (9:16), como se fosse uma selfie de alta qualidade: câmera à frente da moto, de frente para o piloto.",
      `${who[0]!.toUpperCase()}${who.slice(1)} pilotando a moto na rua, de capacete aberto com a viseira levantada (rosto totalmente visível), mãos no guidão, sorrindo, olhando para a câmera.${seg.scene}`,
    ];
  }
  const where = seg.vehicle === "van" ? "dentro de uma van de passageiros" : seg.vehicle === "cabine" ? "dentro da cabine de um caminhãozinho de fretes" : "dentro do carro";
  const back = seg.vehicle === "van"
    ? "Passageiros sentados nos bancos de trás da van, todos de cinto e de frente."
    : seg.vehicle === "cabine"
      ? "Carroceria com carga bem arrumada aparecendo pelo vidro de trás. Todos de cinto."
      : "Um casal no banco de trás com a garrafinha d'água, todos de cinto. Todo mundo de frente.";
  return [
    `Crie uma imagem fotorrealista no formato vertical 1080x1920 (9:16): avatar ${where}, como se fosse uma selfie de alta qualidade, imagem de alta qualidade, câmera na parte frontal interna do veículo, de frente para os ocupantes.`,
    "Motorista no banco do lado ESQUERDO (padrão Brasil), com a mão no volante, olhando para frente, sorrindo.",
    `Como a câmera está de frente, na imagem ${who} e o volante aparecem do lado DIREITO da foto e o banco do carona vazio aparece do lado ESQUERDO da foto.`,
    `${back}${seg.scene}`,
  ];
}

/** Prompt OFICIAL do avatar dentro do carro (o mesmo usado no ChatGPT), com a foto do cliente anexada. */
export function avatarPrompt(o: PromptOrder) {
  const woman = o.driverGender === "feminino";
  const city = promptText(o.city, 80);
  return [
    `Use ${woman ? "a mulher da foto anexada como a motorista" : "a pessoa da foto anexada como o motorista"}, mantendo exatamente o mesmo rosto, cabelo, ${woman ? "" : "barba "}e traços.`,
    ...avatarScene(o.modality, woman ? "a motorista" : "o motorista"),
    `Iluminação natural de dia, paisagem ${city ? `da cidade de ${city}` : "da cidade do cliente"} ${SEGMENTS[o.modality].vehicle === "moto" ? "ao fundo" : "nas janelas"}. Sem textos na imagem.`,
    o.adjustments ? `Ajustes pedidos pelo cliente: ${promptText(o.adjustments, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Prompt OFICIAL de animação (modelo usado no Flow), adaptado ao Veo: 8 s de fala.
 * O WhatsApp no rodapé e a logo final com o nome são desenhados pelo FFmpeg (a IA erra letras e números),
 * por isso o vídeo da IA vem sem textos.
 */
export function animationPrompt(o: PromptOrder) {
  const woman = o.driverGender === "feminino";
  const m = woman ? "a motorista" : "o motorista";
  const M = `${m[0]!.toUpperCase()}${m.slice(1)}`;
  const moto = SEGMENTS[o.modality].vehicle === "moto";
  const alone = o.modality === "motoboy" || SEGMENTS[o.modality].vehicle === "cabine";
  return [
    `PROMPT DE ANIMAÇÃO — ${promptText(o.driverName, 80)} | 8 SEGUNDOS. FALA D${woman ? "A" : "O"} MOTORISTA: "${promptText(o.speech, 400)}"`,
    `DIREÇÃO DE CENA: ${M} fala do início ao fim, extremamente animad${woman ? "a" : "o"}, carismátic${woman ? "a" : "o"}, sorridente e eloquente, com energia de apresentador${woman ? "a" : ""} de comercial de televisão.`,
    moto
      ? `ENQUADRAMENTO OBRIGATÓRIO: Câmera à frente da moto, plano médio, mostrando ${m} pilotando${o.modality === "mototaxi" ? " e o passageiro na garupa" : ""}, sem cortes, sem mudar o ângulo. A moto anda devagar, com a rua passando naturalmente ao fundo.`
      : `ENQUADRAMENTO OBRIGATÓRIO: Câmera em plano aberto, posicionada na parte frontal interna do veículo, mostrando simultaneamente ${m} dirigindo, o banco do passageiro dianteiro${alone ? "" : " e os passageiros no banco traseiro"}. Manter todos os ocupantes visíveis durante toda a fala, sem cortes, sem mudar o ângulo e sem aproximar excessivamente a câmera. O veículo permanece em movimento, com paisagem externa passando naturalmente pelas janelas.`,
    `ANIMAÇÃO E SINCRONIZAÇÃO: Apenas ${m} fala, do início ao fim. Sincronização labial perfeita em português brasileiro. Voz ${woman ? "FEMININA" : "masculina"} extremamente animada, vibrante e convincente.${alone ? "" : " Passageiros permanecem sorridentes, com movimentos naturais, sem falar."} ${moto ? `${M} usa capacete aberto e mantém as mãos no guidão.` : `Todos utilizando cinto de segurança. ${M} mantém as mãos no volante e a atenção na estrada.`} Movimentos cinematográficos suaves, sem alterar rostos ou características dos personagens.`,
    `REGRAS: Formato story vertical 9:16. Não cortar a fala. Não trocar de cenário durante a locução.${alone ? "" : " Não esconder os passageiros."} Não adicionar outras vozes. Sem textos, legendas ou logotipos na tela. Preservar a identidade original dos personagens.`,
    o.adjustments ? `AJUSTES PEDIDOS PELO CLIENTE: ${promptText(o.adjustments, 500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Textos desenhados pelo FFmpeg: WhatsApp no rodapé durante o vídeo e logo final (nome em dourado, fundo preto). */
export function endCardLines(o: Pick<VideoOrder, "modality" | "driverName" | "contactPhone">) {
  return {
    title: promptText(o.driverName, 40),
    subtitle: SEGMENTS[o.modality]?.subtitle ?? "MOTORISTA",
    phone: o.contactPhone ? formatBrPhone(o.contactPhone) : "",
  };
}

/** Geração que passou de 15 min sem terminar (servidor reiniciou no meio): tratada como falha, pode refazer. */
export function isStuck(o: Pick<VideoOrder, "status" | "updatedAt">, now = Date.now()) {
  return (o.status === "gerando_avatar" || o.status === "gerando_video") && now - Date.parse(o.updatedAt) > 15 * 60_000;
}
