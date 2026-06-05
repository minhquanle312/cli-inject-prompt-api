import { listAdapters } from "./adapters.js";
import type {
  AssistantToolCall,
  ChatCompletionRequest,
  ChatMessage,
  ChatRole,
  CommandFailure,
  CommandSuccess,
  ModelId,
  ParsedAssistantResult,
  ProxyTool,
  ResponsesRequest,
  ToolChoice,
} from "./types.js";

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
      content?: string | null;
      tool_calls?: AssistantToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | null;
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

const roles = new Set<ChatRole>(["system", "developer", "user", "assistant", "tool"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
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

function parseMessageContent(value: unknown): string | undefined | HttpError {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    return { status: 400, code: "invalid_request_error", message: "Message content must be a string or content part array" };
  }

  const text = value.map(parseContentPart).filter((part): part is string => part !== undefined).join("\n");
  return text;
}

function parseToolCall(value: unknown): AssistantToolCall | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "tool_calls entries must be objects" };
  const id = normalizeText(value.id);
  const type = normalizeText(value.type);
  if (!id || type !== "function" || !isRecord(value.function) || !normalizeText(value.function.name)) {
    return { status: 400, code: "invalid_request_error", message: "tool_calls entries must be OpenAI function calls" };
  }
  const args = value.function.arguments;
  const argumentsText =
    typeof args === "string" ? args : args === undefined ? "{}" : JSON.stringify(args);
  return {
    id,
    type: "function",
    function: {
      name: value.function.name as string,
      arguments: argumentsText,
    },
  };
}

function parseToolDefinition(value: unknown): ProxyTool | HttpError {
  if (!isRecord(value) || value.type !== "function" || !isRecord(value.function) || typeof value.function.name !== "string") {
    return { status: 400, code: "invalid_request_error", message: "tools must use the OpenAI function tool shape" };
  }
  const fn: ProxyTool["function"] = { name: value.function.name };
  if (typeof value.function.description === "string") fn.description = value.function.description;
  if (value.function.parameters !== undefined) fn.parameters = value.function.parameters;
  if (value.function.strict === true) fn.strict = true;
  return {
    type: "function",
    function: fn,
  };
}

function parseToolChoice(value: unknown): ToolChoice | HttpError | undefined {
  if (value === undefined) return undefined;
  if (value === "none" || value === "auto" || value === "required") return value;
  if (
    isRecord(value) &&
    value.type === "function" &&
    isRecord(value.function) &&
    typeof value.function.name === "string"
  ) {
    return { type: "function", function: { name: value.function.name } };
  }
  return { status: 400, code: "invalid_request_error", message: "tool_choice must be auto, none, required, or a function selector" };
}

function parseMessage(value: unknown): ChatMessage | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Each message must be an object" };
  const role = value.role;
  if (typeof role !== "string" || !roles.has(role as ChatRole)) {
    return { status: 400, code: "invalid_request_error", message: "Message role must be system, developer, user, assistant, or tool" };
  }
  const content = parseMessageContent(value.content);
  if (content && typeof content !== "string") return content;
  const message: ChatMessage = { role: role as ChatRole };
  if (content !== undefined) message.content = content;
  if (typeof value.name === "string") message.name = value.name;
  if (typeof value.tool_call_id === "string") message.tool_call_id = value.tool_call_id;
  if (Array.isArray(value.tool_calls)) {
    const toolCalls: AssistantToolCall[] = [];
    for (const item of value.tool_calls) {
      const parsed = parseToolCall(item);
      if ("status" in parsed) return parsed;
      toolCalls.push(parsed);
    }
    message.tool_calls = toolCalls;
  }
  return message;
}

function parseTools(value: unknown): ProxyTool[] | HttpError {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { status: 400, code: "invalid_request_error", message: "tools must be an array" };
  const tools: ProxyTool[] = [];
  for (const item of value) {
    const parsed = parseToolDefinition(item);
    if ("status" in parsed) return parsed;
    tools.push(parsed);
  }
  return tools;
}

export function parseChatCompletionRequest(value: unknown): ChatCompletionRequest | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Request body must be a JSON object" };
  if (value.stream !== undefined && value.stream !== false && value.stream !== true) {
    return { status: 400, code: "invalid_request_error", message: "stream must be a boolean when provided" };
  }
  if (typeof value.model !== "string") return { status: 400, code: "invalid_request_error", message: "model is required" };
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    return { status: 400, code: "invalid_request_error", message: "messages must be a non-empty array" };
  }

  const messages: ChatMessage[] = [];
  for (const item of value.messages) {
    const parsed = parseMessage(item);
    if ("status" in parsed) return parsed;
    messages.push(parsed);
  }

  const tools = parseTools(value.tools);
  if ("status" in tools) return tools;
  const toolChoice = parseToolChoice(value.tool_choice);
  if (isRecord(toolChoice) && "status" in toolChoice) return toolChoice as HttpError;

  const request: ChatCompletionRequest = { model: value.model as ModelId, messages, tools, stream: value.stream === true };
  if (toolChoice !== undefined) request.toolChoice = toolChoice;
  return request;
}

export function parseResponsesRequest(value: unknown): ResponsesRequest | HttpError {
  if (!isRecord(value)) return { status: 400, code: "invalid_request_error", message: "Request body must be a JSON object" };
  if (value.stream !== undefined && value.stream !== false && value.stream !== true) {
    return { status: 400, code: "invalid_request_error", message: "stream must be a boolean when provided" };
  }
  if (typeof value.model !== "string") return { status: 400, code: "invalid_request_error", message: "model is required" };

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
  const tools = parseTools(value.tools);
  if ("status" in tools) return tools;
  const toolChoice = parseToolChoice(value.tool_choice);
  if (isRecord(toolChoice) && "status" in toolChoice) return toolChoice as HttpError;
  const request: ResponsesRequest = { model: value.model as ModelId, messages, tools, stream: value.stream === true };
  if (toolChoice !== undefined) request.toolChoice = toolChoice;
  return request;
}

export function buildModelsResponse(created = 0): unknown {
  return {
    object: "list",
    data: listAdapters().map((adapter) => ({
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

function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function parseToolCallsArray(value: unknown): AssistantToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const toolCalls: AssistantToolCall[] = [];
  for (const item of value) {
    const parsed = parseToolCall(item);
    if ("status" in parsed) return undefined;
    toolCalls.push(parsed);
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

export function parseAssistantOutput(raw: string): ParsedAssistantResult {
  const text = stripFence(raw);
  if (text === "") return { kind: "message", content: "" };

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      if (parsed.type === "tool_calls") {
        const toolCalls = parseToolCallsArray(parsed.tool_calls);
        if (toolCalls) return { kind: "tool_calls", toolCalls };
      }
      if (parsed.type === "message" && typeof parsed.content === "string") {
        return { kind: "message", content: parsed.content };
      }
      const directToolCalls = parseToolCallsArray(parsed.tool_calls);
      if (directToolCalls) return { kind: "tool_calls", toolCalls: directToolCalls };
      if (Array.isArray(parsed.choices)) {
        const choice = parsed.choices[0];
        if (isRecord(choice) && isRecord(choice.message)) {
          const fromChoice = parseToolCallsArray(choice.message.tool_calls);
          if (fromChoice) return { kind: "tool_calls", toolCalls: fromChoice };
          if (typeof choice.message.content === "string") return { kind: "message", content: choice.message.content };
        }
      }
      if (Array.isArray(parsed.output)) {
        const toolCalls = parsed.output
          .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "function_call")
          .map((item, index) => ({
            id: typeof item.call_id === "string" ? item.call_id : `call_${index + 1}`,
            type: "function" as const,
            function: {
              name: typeof item.name === "string" ? item.name : "unknown_tool",
              arguments:
                typeof item.arguments === "string"
                  ? item.arguments
                  : item.arguments === undefined
                    ? "{}"
                    : JSON.stringify(item.arguments),
            },
          }));
        if (toolCalls.length > 0) return { kind: "tool_calls", toolCalls };
        const textPart = parsed.output.find(
          (item): item is Record<string, unknown> =>
            isRecord(item) &&
            item.type === "message" &&
            Array.isArray(item.content) &&
            isRecord(item.content[0]) &&
            typeof item.content[0]?.text === "string",
        );
        const firstPart = textPart && Array.isArray(textPart.content) ? textPart.content[0] : undefined;
        if (isRecord(firstPart) && typeof firstPart.text === "string") return { kind: "message", content: firstPart.text };
      }
    }
  } catch {
    // Fallback to plain text content.
  }

  return { kind: "message", content: text };
}

export function buildChatCompletionResponse(model: ModelId, result: CommandSuccess, created = Math.floor(Date.now() / 1000)): unknown {
  const parsed = parseAssistantOutput(outputText(result));
  return {
    id: `chatcmpl-local-${created}`,
    object: "chat.completion",
    created,
    model,
    choices: [
      parsed.kind === "tool_calls"
        ? {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: parsed.toolCalls },
            finish_reason: "tool_calls",
          }
        : {
            index: 0,
            message: { role: "assistant", content: parsed.content },
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

export function buildChatCompletionToolCallsChunk(state: ChatCompletionStreamState, toolCalls: AssistantToolCall[]): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
  };
}

export function buildChatCompletionStopChunk(state: ChatCompletionStreamState, finishReason: "stop" | "tool_calls" = "stop"): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };
}

function buildResponseBody(model: ModelId, parsed: ParsedAssistantResult, created: number, id = `resp-local-${created}`): unknown {
  const itemId = `msg-local-${created}`;
  const output =
    parsed.kind === "tool_calls"
      ? parsed.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function_call",
          status: "completed",
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        }))
      : [
          {
            id: itemId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: parsed.content, annotations: [] }],
          },
        ];
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
    output,
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
  return buildResponseBody(model, parseAssistantOutput(outputText(result)), created);
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

export function buildResponseFunctionCallEvents(state: ResponsesStreamState, toolCalls: AssistantToolCall[]): unknown[] {
  return toolCalls.flatMap((toolCall, index) => [
    {
      type: "response.output_item.added",
      output_index: index,
      item: {
        id: toolCall.id,
        type: "function_call",
        status: "in_progress",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      output_index: index,
      item_id: toolCall.id,
      delta: toolCall.function.arguments,
    },
    {
      type: "response.function_call_arguments.done",
      output_index: index,
      item_id: toolCall.id,
      arguments: toolCall.function.arguments,
    },
    {
      type: "response.output_item.done",
      output_index: index,
      item: {
        id: toolCall.id,
        type: "function_call",
        status: "completed",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    },
  ]);
}

export function buildResponseCompletedEvents(state: ResponsesStreamState, parsed: ParsedAssistantResult): unknown[] {
  if (parsed.kind === "tool_calls") {
    return [...buildResponseFunctionCallEvents(state, parsed.toolCalls), { type: "response.completed", response: buildResponseBody(state.model, parsed, state.created, state.id) }];
  }
  const part = { type: "output_text", text: parsed.content, annotations: [] };
  const item = { id: state.itemId, type: "message", status: "completed", role: "assistant", content: [part] };
  return [
    { type: "response.output_text.done", item_id: state.itemId, output_index: 0, content_index: 0, text: parsed.content },
    { type: "response.content_part.done", item_id: state.itemId, output_index: 0, content_index: 0, part },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: buildResponseBody(state.model, parsed, state.created, state.id) },
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
