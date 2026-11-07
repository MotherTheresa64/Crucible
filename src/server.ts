import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { lex, run, ExpressionError } from "./expression.ts";

let cachedPage: string | null = null;

function indexHtml(): string {
  if (cachedPage === null) {
    cachedPage = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  }
  return cachedPage;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(err instanceof Error && err.message.startsWith("request body") ? err.message : "request body is not valid JSON");
  }
}

function describe(err: unknown): { message: string; position?: number } {
  if (err instanceof ExpressionError) return { message: err.message, position: err.position };
  return { message: err instanceof Error ? err.message : "unexpected failure" };
}

export function createApp(): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, indexHtml(), "text/html; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok" });
      }

      if (req.method === "POST" && url.pathname === "/evaluate") {
        const body = await readJson(req);
        const source = String(body.source ?? "");
        const env = body.env && typeof body.env === "object" && !Array.isArray(body.env)
          ? (body.env as Record<string, unknown>)
          : {};
        try {
          return send(res, 200, { ok: true, value: run(source, env) });
        } catch (err) {
          return send(res, 400, { ok: false, error: describe(err) });
        }
      }

      if (req.method === "POST" && url.pathname === "/tokens") {
        const body = await readJson(req);
        try {
          return send(res, 200, { tokens: lex(String(body.source ?? "")) });
        } catch (err) {
          return send(res, 400, { tokens: [], error: describe(err) });
        }
      }

      return send(res, 404, { error: "not_found", path: url.pathname });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("request body")) {
        return send(res, 400, { error: "invalid", message: err.message });
      }
      return send(res, 500, { error: "internal", message: "unexpected failure" });
    }
  });
}

// pathToFileURL matters on Windows: argv[1] is a drive path there, which never
// equals the file:/// URL form.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = Number(process.env.PORT ?? 4100);
  createApp().listen(port, () => {
    console.log(`crucible listening on http://localhost:${port}`);
  });
}
