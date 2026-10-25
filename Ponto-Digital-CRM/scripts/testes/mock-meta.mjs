// Simulador da Graph API da Meta (WhatsApp Cloud API) — SOMENTE para testes locais.
// Nada aqui fala com a Meta de verdade. Registra cada chamada para o teste conferir.
//
//   TOKEN=token-de-teste PORT=4010 node scripts/testes/mock-meta.mjs
//   GET /__log  → chamadas recebidas      POST /__reset → limpa o registro
import http from "node:http";

const PORT = Number(process.env.PORT || 4010);
const TOKEN = process.env.TOKEN || "token-de-teste";
const log = [];
const templates = [];
let seq = 0;
// PNG 1x1 transparente
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((r) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => r(Buffer.concat(chunks)));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const raw = await readBody(req);
    if (url.pathname === "/__log") return json(res, 200, log);
    if (url.pathname === "/__reset") {
      log.length = 0;
      return json(res, 200, { ok: true });
    }
    const auth = req.headers.authorization || "";
    if (url.pathname.startsWith("/download/")) {
      if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: { message: "Invalid OAuth access token", code: 190 } });
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    const segs = url.pathname.split("/").filter(Boolean); // [v23.0, id, edge?]
    const [, id, edge] = segs;
    const isJson = (req.headers["content-type"] || "").includes("application/json");
    const body = isJson && raw.length ? JSON.parse(raw.toString()) : null;
    const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, bytes: isJson ? undefined : raw.length };
    log.push(entry);

    if (id === "oauth" && edge === "access_token") {
      return url.searchParams.get("code") === "CODIGO-OK" ? json(res, 200, { access_token: TOKEN, token_type: "bearer" }) : json(res, 400, { error: { message: "Invalid code" } });
    }
    if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: { message: "Invalid OAuth access token", code: 190 } });

    if (edge === "messages" && req.method === "POST") {
      if (!body?.to) return json(res, 400, { error: { message: "missing to" } });
      return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.MOCK.${++seq}` }] });
    }
    if (edge === "media" && req.method === "POST") return json(res, 200, { id: `MEDIA.UP.${++seq}` });
    if (edge === "subscribed_apps") return json(res, 200, { success: true });
    if (edge === "smb_app_data") return json(res, 200, { success: true });
    if (edge === "message_templates" && req.method === "POST") {
      const t = { id: `TPL${++seq}`, name: body.name, language: body.language, category: body.category, status: "PENDING", components: body.components };
      templates.push(t);
      return json(res, 200, { id: t.id, status: t.status, category: t.category });
    }
    if (edge === "message_templates" && req.method === "GET") return json(res, 200, { data: templates, paging: {} });
    if (!edge && req.method === "GET" && /^(M|MEDIA)/.test(id)) {
      return json(res, 200, { url: `http://127.0.0.1:${PORT}/download/${id}`, mime_type: "image/png", file_size: PNG.length, id });
    }
    if (!edge && req.method === "GET") {
      return json(res, 200, { id, display_phone_number: "+55 11 90000-0000", verified_name: "Ponto Digital", is_on_biz_app: true, platform_type: "CLOUD_API" });
    }
    json(res, 404, { error: { message: `Rota não simulada: ${req.method} ${url.pathname}` } });
  })
  .listen(PORT, "127.0.0.1", () => console.log("simulador da Meta na porta", PORT));
