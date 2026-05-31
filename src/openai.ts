import { getAdapter, listModels } from "./adapters.js";
import type { ChatCompletionRequest, ChatMessage, ChatRole, CommandFailure, CommandSuccess, ModelId, ResponsesRequest } from "./types.js";

export type HttpError = {
  status: number;
  code: string;
  message: string;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: ModelId;
  choices: Array<{
    index: 0;
    delta: {
      role?: "assistant";
      content?: string;
    };
    finish_reason: "stop" | null;
  }>;
};

export type ChatCompletionStreamState = {
  id: string;
  created: number;
  model: ModelId;
};

export type ResponsesStreamState = {
  id: string;
  created: number;
  model: ModelId;
  itemId: string;
};

const roles = new Set<ChatRole>(["system", "developer", "user", "assistant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseContentPart(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.text === "string") return value.text;
  if (value.type === "image_url" && isRecord(value.image_url) && typeof value.image_url.url === "string") {
    return `[image: ${value.image_url.url}]`;
  }
  if (value.type === "input_image" && typeof value.image_url === "string") return `[image: ${value.image_url}]`;
  return undefined;
}

function parseMessageContent(value: unknown): string | HttpError {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    return { status: 400, code: "invalid_request_error", message: "Message content must be a string or content part array" };
  }

  const text = value.map(parseContentPart).filter((part): part is string => part !== undefined).join("\n");
  return text;
}

function parseMessage(value: unknown): ChatMessage | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Each message must be an object" };
  const role = value.role;
  if (typeof role !== "string" || !roles.has(role as ChatRole)) {
    return { status: 400, code: "invalid_request_error", message: "Message role must be system, developer, user, or assistant" };
  }
  const content = parseMessageContent(value.content);
  if (typeof content !== "string") return content;
  return { role: role as ChatRole, content };
}

export function parseChatCompletionRequest(value: unknown): ChatCompletionRequest | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Request body must be a JSON object" };
  if (value.stream !== undefined && value.stream !== false) {
    if (value.stream !== true) {
      return { status: 400, code: "invalid_request_error", message: "stream must be a boolean when provided" };
    }
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

  return { model: adapter.id, messages, stream: value.stream === true };
}

export function parseResponsesRequest(value: unknown): ResponsesRequest | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Request body must be a JSON object" };
  if (value.stream !== undefined && value.stream !== false && value.stream !== true) {
    return { status: 400, code: "invalid_request_error", message: "stream must be a boolean when provided" };
  }
  if (typeof value.model !== "string") return { status: 400, code: "invalid_request_error", message: "model is required" };
  const adapter = getAdapter(value.model);
  if (adapter === undefined) return { status: 400, code: "model_not_found", message: `Unsupported model: ${value.model}` };

  const messages: ChatMessage[] = [];
  if (typeof value.instructions === "string" && value.instructions.trim() !== "") {
    messages.push({ role: "system", content: value.instructions });
  }

  const input = value.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
        continue;
      }
      const parsed = parseMessage(item);
      if ("status" in parsed) return parsed;
      messages.push(parsed);
    }
  } else {
    return { status: 400, code: "invalid_request_error", message: "input is required and must be a string or array" };
  }

  if (messages.length === 0) return { status: 400, code: "invalid_request_error", message: "input must not be empty" };
  return { model: adapter.id, messages, stream: value.stream === true };
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

function outputText(result: CommandSuccess): string {
  return result.stdout.trim();
}

export function buildChatCompletionResponse(model: ModelId, result: CommandSuccess, created = Math.floor(Date.now() / 1000)): unknown {
  const content = outputText(result);
  return {
    id: `chatcmpl-local-${created}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function createChatCompletionStreamState(model: ModelId, created = Math.floor(Date.now() / 1000)): ChatCompletionStreamState {
  return { id: `chatcmpl-local-${created}`, created, model };
}

export function buildChatCompletionRoleChunk(state: ChatCompletionStreamState): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
}

export function buildChatCompletionDeltaChunk(state: ChatCompletionStreamState, content: string): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export function buildChatCompletionStopChunk(state: ChatCompletionStreamState): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
}

export function buildChatCompletionChunks(model: ModelId, result: CommandSuccess, created = Math.floor(Date.now() / 1000)): ChatCompletionChunk[] {
  const content = outputText(result);
  const state = createChatCompletionStreamState(model, created);
  return [
    {
      id: state.id,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        },
      ],
    },
    buildChatCompletionStopChunk(state),
  ];
}

function buildResponseBody(model: ModelId, text: string, created: number, id = `resp-local-${created}`): unknown {
  const itemId = `msg-local-${created}`;
  return {
    id,
    object: "response",
    created_at: created,
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: [
      {
        id: itemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    user: null,
    metadata: {},
  };
}

export function buildResponsesResponse(model: ModelId, result: CommandSuccess, created = Math.floor(Date.now() / 1000)): unknown {
  return buildResponseBody(model, outputText(result), created);
}

export function createResponsesStreamState(model: ModelId, created = Math.floor(Date.now() / 1000)): ResponsesStreamState {
  return { id: `resp-local-${created}`, created, model, itemId: `msg-local-${created}` };
}

export function buildResponseCreatedEvent(state: ResponsesStreamState): unknown {
  return { type: "response.created", response: { id: state.id, object: "response", created_at: state.created, status: "in_progress", model: state.model, output: [] } };
}

export function buildResponseOutputItemAddedEvent(state: ResponsesStreamState): unknown {
  return { type: "response.output_item.added", output_index: 0, item: { id: state.itemId, type: "message", status: "in_progress", role: "assistant", content: [] } };
}

export function buildResponseContentPartAddedEvent(state: ResponsesStreamState): unknown {
  return { type: "response.content_part.added", item_id: state.itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } };
}

export function buildResponseTextDeltaEvent(state: ResponsesStreamState, delta: string): unknown {
  return { type: "response.output_text.delta", item_id: state.itemId, output_index: 0, content_index: 0, delta };
}

export function buildResponseCompletedEvents(state: ResponsesStreamState, text: string): unknown[] {
  const part = { type: "output_text", text, annotations: [] };
  const item = { id: state.itemId, type: "message", status: "completed", role: "assistant", content: [part] };
  return [
    { type: "response.output_text.done", item_id: state.itemId, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: state.itemId, output_index: 0, content_index: 0, part },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: buildResponseBody(state.model, text, state.created, state.id) },
  ];
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
