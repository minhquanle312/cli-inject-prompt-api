import { getAdapter, listModels } from "./adapters.js";
import type { ChatCompletionRequest, ChatMessage, ChatRole, CommandFailure, CommandSuccess, ModelId } from "./types.js";

export type HttpError = {
  status: number;
  code: string;
  message: string;
};

const roles = new Set<ChatRole>(["system", "developer", "user", "assistant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown): ChatMessage | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Each message must be an object" };
  const role = value.role;
  const content = value.content;
  if (typeof role !== "string" || !roles.has(role as ChatRole)) {
    return { status: 400, code: "invalid_request_error", message: "Message role must be system, developer, user, or assistant" };
  }
  if (typeof content !== "string") {
    return { status: 400, code: "invalid_request_error", message: "Only string message content is supported" };
  }
  return { role: role as ChatRole, content };
}

export function parseChatCompletionRequest(value: unknown): ChatCompletionRequest | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Request body must be a JSON object" };
  if (value.stream === true) return { status: 400, code: "unsupported_stream", message: "stream=true is not supported by this local proxy" };
  if (value.stream !== undefined && value.stream !== false) {
    return { status: 400, code: "invalid_request_error", message: "stream must be false when provided" };
  }
  if (typeof value.model !== "string") return { status: 400, code: "invalid_request_error", message: "model is required" };
  const adapter = getAdapter(value.model);
  if (adapter === undefined) return { status: 400, code: "model_not_found", message: `Unsupported model: ${value.model}` };
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    return { status: 400, code: "invalid_request_error", message: "messages must be a non-empty array" };
  }

  const messages: ChatMessage[] = [];
  for (const item of value.messages) {
    const parsed = parseMessage(item);
    if ("status" in parsed) return parsed;
    messages.push(parsed);
  }

  return { model: adapter.id, messages, stream: false };
}

export function buildModelsResponse(created = 0): unknown {
  return {
    object: "list",
    data: listModels().map((adapter) => ({
      id: adapter.id,
      object: "model",
      created,
      owned_by: adapter.command,
    })),
  };
}

export function buildChatCompletionResponse(model: ModelId, result: CommandSuccess, created = Math.floor(Date.now() / 1000)): unknown {
  return {
    id: `chatcmpl-local-${created}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.stdout.trim() },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function errorBody(error: HttpError): unknown {
  return { error: { message: error.message, type: error.code, code: error.code } };
}

export function commandFailureToHttp(error: CommandFailure): HttpError {
  if (error.kind === "timeout") return { status: 504, code: "backend_timeout", message: error.message };
  if (error.kind === "spawn_error") return { status: 502, code: "backend_spawn_error", message: error.message };
  const detail = error.stderr.trim() || error.stdout.trim() || error.message;
  return { status: 502, code: "backend_error", message: detail };
}
