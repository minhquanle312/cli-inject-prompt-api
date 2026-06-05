import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getAdapter } from "./adapters.js";
import { buildModelCatalog, buildModelMetadata } from "./models.js";
import { buildPrompt } from "./prompt.js";
import { runCommand } from "./runner.js";
import { QueueFullError, Scheduler } from "./scheduler.js";
import type { CommandOutputEvent, ServerConfig } from "./types.js";
import {
  buildChatCompletionDeltaChunk,
  buildChatCompletionResponse,
  buildChatCompletionRoleChunk,
  buildChatCompletionStopChunk,
  buildChatCompletionToolCallsChunk,
  buildModelsResponse,
  buildResponseCompletedEvents,
  buildResponseContentPartAddedEvent,
  buildResponseCreatedEvent,
  buildResponseOutputItemAddedEvent,
  buildResponsesResponse,
  buildResponseTextDeltaEvent,
  commandFailureToHttp,
  createChatCompletionStreamState,
  createResponsesStreamState,
  errorBody,
  parseAssistantOutput,
  type HttpError,
  parseChatCompletionRequest,
  parseResponsesRequest,
} from "./openai.js";

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
  startSse(response, status);
  for (const chunk of chunks) writeSse(response, chunk);
  endSse(response);
}

function startSse(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
  response.write(":\n\n");
}

function writeSse(response: ServerResponse, chunk: unknown): void {
  if (response.writableEnded) return;
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function endSse(response: ServerResponse): void {
  if (response.writableEnded) return;
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

function formatOutputEvent(event: CommandOutputEvent): string {
  return event.stream === "stdout" ? event.text : `\n[${event.stream}] ${event.text}`;
}

function buildPromptOptions<T extends { tools: readonly unknown[]; toolChoice?: unknown }>(parsed: T): { tools: T["tools"]; toolChoice?: T["toolChoice"] } {
  return parsed.toolChoice === undefined ? { tools: parsed.tools } : { tools: parsed.tools, toolChoice: parsed.toolChoice };
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

    if (url.pathname === "/v1/models/metadata") {
      if (request.method !== "GET") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use GET for /v1/models/metadata" });
        return;
      }
      sendJson(response, 200, buildModelMetadata());
      return;
    }

    if (url.pathname === "/v1/models/catalog") {
      if (request.method !== "GET") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use GET for /v1/models/catalog" });
        return;
      }
      sendJson(response, 200, buildModelCatalog(`http://${config.host}:${config.port}`));
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
        if (parsed.stream === true) {
          const state = createChatCompletionStreamState(parsed.model);
          const pending: string[] = [];
          let streamStarted = false;
          let stderrOutput = "";
          const onOutput = (event: CommandOutputEvent): void => {
            if (event.stream === "stdout") return;
            stderrOutput += event.text;
            const text = formatOutputEvent(event);
            if (streamStarted) writeSse(response, buildChatCompletionDeltaChunk(state, text));
            else pending.push(text);
          };

          const pendingResult = scheduler.enqueue(adapter, buildPrompt(parsed.messages, buildPromptOptions(parsed)), onOutput);
          let immediateError: unknown;
          pendingResult.catch((error: unknown) => {
            immediateError = error;
          });
          await Promise.resolve();
          if (immediateError !== undefined) throw immediateError;

          startSse(response, 200);
          streamStarted = true;
          writeSse(response, buildChatCompletionRoleChunk(state));
          for (const text of pending) writeSse(response, buildChatCompletionDeltaChunk(state, text));
          const result = await pendingResult;
          if (!result.ok) {
            writeSse(response, errorBody(commandFailureToHttp(result)));
            endSse(response);
            return;
          }
          const parsedOutput = parseAssistantOutput(result.stdout);
          if (parsedOutput.kind === "tool_calls") {
            writeSse(response, buildChatCompletionToolCallsChunk(state, parsedOutput.toolCalls));
            writeSse(response, buildChatCompletionStopChunk(state, "tool_calls"));
            endSse(response);
            return;
          }
          if (stderrOutput.trim() !== "" && parsedOutput.content.trim() !== "") writeSse(response, buildChatCompletionDeltaChunk(state, "\n"));
          if (parsedOutput.content.trim() !== "") writeSse(response, buildChatCompletionDeltaChunk(state, parsedOutput.content));
          writeSse(response, buildChatCompletionStopChunk(state, "stop"));
          endSse(response);
          return;
        }

        const result = await scheduler.enqueue(adapter, buildPrompt(parsed.messages, buildPromptOptions(parsed)));
        if (!result.ok) {
          sendError(response, commandFailureToHttp(result));
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

    if (url.pathname === "/v1/responses") {
      if (request.method !== "POST") {
        sendError(response, { status: 405, code: "method_not_allowed", message: "Use POST for /v1/responses" });
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

      const parsed = parseResponsesRequest(body);
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
        if (parsed.stream === true) {
          const state = createResponsesStreamState(parsed.model);
          let stderrOutput = "";
          const onOutput = (event: CommandOutputEvent): void => {
            if (event.stream === "stdout") return;
            stderrOutput += formatOutputEvent(event);
          };

          const pendingResult = scheduler.enqueue(adapter, buildPrompt(parsed.messages, buildPromptOptions(parsed)), onOutput);
          let immediateError: unknown;
          pendingResult.catch((error: unknown) => {
            immediateError = error;
          });
          await Promise.resolve();
          if (immediateError !== undefined) throw immediateError;

          startSse(response, 200);
          writeSse(response, buildResponseCreatedEvent(state));
          const result = await pendingResult;
          if (!result.ok) {
            const body = errorBody(commandFailureToHttp(result)) as { error: unknown };
            writeSse(response, { type: "response.failed", response: { id: state.id, status: "failed", error: body.error } });
            endSse(response);
            return;
          }
          const parsedOutput = parseAssistantOutput(result.stdout);
          if (parsedOutput.kind === "message" && parsedOutput.content.trim() !== "") {
            writeSse(response, buildResponseOutputItemAddedEvent(state));
            writeSse(response, buildResponseContentPartAddedEvent(state));
            if (stderrOutput.trim() !== "") writeSse(response, buildResponseTextDeltaEvent(state, "\n"));
            if (stderrOutput.trim() !== "") writeSse(response, buildResponseTextDeltaEvent(state, stderrOutput));
            writeSse(response, buildResponseTextDeltaEvent(state, parsedOutput.content));
          }
          for (const event of buildResponseCompletedEvents(state, parsedOutput)) writeSse(response, event);
          endSse(response);
          return;
        }

        const result = await scheduler.enqueue(adapter, buildPrompt(parsed.messages, buildPromptOptions(parsed)));
        if (!result.ok) {
          sendError(response, commandFailureToHttp(result));
          return;
        }
        sendJson(response, 200, buildResponsesResponse(parsed.model, result));
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
