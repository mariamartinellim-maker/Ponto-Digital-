// Simulador da API da Anthropic (Messages) — SOMENTE para testes locais, sem custo.
// Devolve sugestões de resposta e leituras de comprovante no formato estruturado pedido pelo CRM.
//
//   PORT=4020 node scripts/testes/mock-anthropic.mjs     (no CRM: ANTHROPIC_BASE_URL=http://127.0.0.1:4020)
//   GET /__log → requisições recebidas
//   POST /__comprovante {campos} → define a próxima leitura de comprovante (valor, data, pagador…)
import http from "node:http";

const PORT = Number(process.env.PORT || 4020);
const log = [];
let receipt = {
  e_comprovante: true,
  valor: "R$ 1.500,00",
  data_pagamento: new Date().toISOString().slice(0, 10),
  pagador: "Cliente Teste",
  recebedor: "Ponto Digital",
  banco: "Banco Simulado",
  metodo: "pix",
  id_transacao: "E00000000202610261200SIMULADO01",
  confianca: 0.95,
  observacao: "",
};

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/__log") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(log));
      }
      if (url.pathname === "/__comprovante" && req.method === "POST") {
        receipt = { ...receipt, ...JSON.parse(raw || "{}") };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(receipt));
      }
      if (url.pathname !== "/v1/messages" || req.method !== "POST") {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "not found" } }));
      }
      const body = JSON.parse(raw || "{}");
      // Arquivos em base64 não entram no registro (só o tipo e o tamanho).
      const slim = JSON.parse(JSON.stringify(body), (k, v) => (k === "data" && typeof v === "string" && v.length > 200 ? `[base64 ${v.length}]` : v));
      log.push({ headers: { beta: req.headers["anthropic-beta"], key: req.headers["x-api-key"] || req.headers.authorization ? "presente" : "ausente" }, body: slim });
      const content = body.messages?.at(-1)?.content;
      // Leitura de comprovante: a mensagem traz a imagem/PDF em base64.
      const isFile = Array.isArray(content) && content.some((b) => b.type === "image" || b.type === "document");
      const last = Array.isArray(content) ? content.map((b) => b.text ?? "").join(" ") : String(content ?? "");
      const discount = /desconto/i.test(last);
      const answer = isFile
        ? receipt
        : discount
        ? { resposta: "Entendo! Vou verificar as condições com a equipe e já te retorno.", precisa_humano: true, motivo: "Pedido de desconto: decisão de um gestor.", intencao: "negociacao", etapa_sugerida: "manter" }
        : { resposta: "Olá! Fazemos sites a partir de R$ 2.500. Qual é o seu segmento?", precisa_humano: false, motivo: "Apresenta o serviço e qualifica o cliente.", intencao: "orcamento", etapa_sugerida: "em_atendimento" };
      res.writeHead(200, { "content-type": "application/json", "request-id": `req_mock_${log.length}` });
      res.end(
        JSON.stringify({
          id: `msg_mock_${log.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1500, output_tokens: 90, cache_creation_input_tokens: log.length === 1 ? 1200 : 0, cache_read_input_tokens: log.length > 1 ? 1200 : 0 },
        }),
      );
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log("simulador da Anthropic na porta", PORT));
