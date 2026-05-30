import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getAdapter } from "./adapters.js";
import { buildPrompt } from "./prompt.js";
import { runCommand } from "./runner.js";
import { QueueFullError, Scheduler } from "./scheduler.js";
import type { ServerConfig } from "./types.js";
import { buildChatCompletionChunks, buildChatCompletionResponse, buildModelsResponse, commandFailureToHttp, errorBody, type HttpError, parseChatCompletionRequest } from "./openai.js";

type JsonValue = unknown;

const bodyLimitBytes = 1_000_000;

function sendJson(response: ServerResponse, status: number, body: JsonValue): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendSse(response: ServerResponse, status: number, chunks: unknown[]): void {
  response.writeHead(status, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function sendError(response: ServerResponse, error: HttpError): void {
  sendJson(response, error.status, errorBody(error));
}

function isAuthorized(request: IncomingMessage, apiKey: string): boolean {
  return request.headers.authorization === `Bearer ${apiKey}`;
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > bodyLimitBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim() === "" ? {} : JSON.parse(raw));
      } catch {
        reject(new Error("Malformed JSON body"));
      }
    });
    request.on("error", reject);
  });
}

export function createApp(config: ServerConfig): Server {
  if (config.apiKey.trim() === "") throw new Error("API_KEY is required");

  const scheduler = new Scheduler(config.globalConcurrency, config.maxQueue, runCommand);

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${config.host}:${config.port}`);

    if (url.pathname === "/healthz") {
      if (request.method !== "GET") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use GET for /healthz" });
        return;
      }
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (!isAuthorized(request, config.apiKey)) {
      sendError(response, { status: 401, code: "unauthorized", message: "Missing or invalid bearer token" });
      return;
    }

    if (url.pathname === "/v1/models") {
      if (request.method !== "GET") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use GET for /v1/models" });
        return;
      }
      sendJson(response, 200, buildModelsResponse());
      return;
    }

    if (url.pathname === "/v1/chat/completions") {
      if (request.method !== "POST") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use POST for /v1/chat/completions" });
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid request body";
        sendError(response, { status: message.includes("large") ? 413 : 400, code: "invalid_request_error", message });
        return;
      }

      const parsed = parseChatCompletionRequest(body);
      if ("status" in parsed) {
        sendError(response, parsed);
        return;
      }

      const adapter = getAdapter(parsed.model);
      if (adapter === undefined) {
        sendError(response, { status: 400, code: "model_not_found", message: `Unsupported model: ${parsed.model}` });
        return;
      }

      try {
        const result = await scheduler.enqueue(adapter, buildPrompt(parsed.messages));
        if (!result.ok) {
          sendError(response, commandFailureToHttp(result));
          return;
        }
        if (parsed.stream === true) {
          sendSse(response, 200, buildChatCompletionChunks(parsed.model, result));
          return;
        }
        sendJson(response, 200, buildChatCompletionResponse(parsed.model, result));
      } catch (error) {
        if (error instanceof QueueFullError) {
          sendError(response, { status: 429, code: "queue_full", message: error.message });
          return;
        }
        const message = error instanceof Error ? error.message : "Unexpected server error";
        sendError(response, { status: 500, code: "internal_error", message });
      }
      return;
    }

    sendError(response, { status: 404, code: "not_found", message: "Route not found" });
  });
}
