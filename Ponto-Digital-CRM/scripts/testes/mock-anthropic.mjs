// Simulador da API da Anthropic (Messages) — SOMENTE para testes locais, sem custo.
// Devolve sugestões no formato estruturado pedido pelo CRM e registra as requisições.
//
//   PORT=4020 node scripts/testes/mock-anthropic.mjs     (no CRM: ANTHROPIC_BASE_URL=http://127.0.0.1:4020)
//   GET /__log → requisições recebidas
import http from "node:http";

const PORT = Number(process.env.PORT || 4020);
const log = [];

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
      if (url.pathname !== "/v1/messages" || req.method !== "POST") {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "not found" } }));
      }
      const body = JSON.parse(raw || "{}");
      log.push({ headers: { beta: req.headers["anthropic-beta"], key: req.headers["x-api-key"] ? "presente" : "ausente" }, body });
      const last = String(body.messages?.at(-1)?.content ?? "");
      const discount = /desconto/i.test(last);
      const answer = discount
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
