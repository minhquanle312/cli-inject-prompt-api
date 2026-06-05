export type ModelId = "gemini-3.5-flash" | "kimi-k2.5" | "kimi-k2.6" | "minimax-m2.7" | "glm-5.1";

export type AdapterConfig = {
  id: ModelId;
  command: string;
  args: readonly string[];
  promptTransport: "stdin" | "argument";
  timeoutMs: number;
  concurrency: number;
};

export type ServerConfig = {
  host: string;
  port: number;
  apiKey: string;
  globalConcurrency: number;
  maxQueue: number;
  defaultTimeoutMs: number;
};

export type ChatRole = "system" | "user" | "assistant" | "developer" | "tool";

export type ProxyToolFunction = {
  name: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
};

export type ProxyTool = {
  type: "function";
  function: ProxyToolFunction;
};

export type ProxyToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

export type ToolChoice = ProxyToolChoice;

export type AssistantToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: ChatRole;
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AssistantToolCall[];
};

export type ChatCompletionRequest = {
  model: ModelId;
  messages: ChatMessage[];
  tools: ProxyTool[];
  toolChoice?: ToolChoice;
  stream?: boolean;
};

export type ResponsesRequest = {
  model: ModelId;
  messages: ChatMessage[];
  tools: ProxyTool[];
  toolChoice?: ToolChoice;
  stream?: boolean;
};

export type CommandOutputEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

export type RunCommandInput = {
  command: string;
  args: readonly string[];
  promptTransport: "stdin" | "argument";
  prompt: string;
  timeoutMs: number;
  onOutput?: (event: CommandOutputEvent) => void;
};

export type CommandSuccess = {
  ok: true;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandFailureKind = "spawn_error" | "nonzero_exit" | "timeout";

export type CommandFailure = {
  ok: false;
  kind: CommandFailureKind;
  message: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type CommandResult = CommandSuccess | CommandFailure;

export type ParsedAssistantMessage = {
  kind: "message";
  content: string;
};

export type ParsedAssistantToolCalls = {
  kind: "tool_calls";
  toolCalls: AssistantToolCall[];
};

export type ParsedAssistantResult = ParsedAssistantMessage | ParsedAssistantToolCalls;

export type ModelRegistryEntry = AdapterConfig & {
  provider: string;
  name: string;
  description: string;
  releaseDate: string;
  lastUpdated: string;
  capabilities: {
    toolCall: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    topP: boolean;
    streaming: boolean;
  };
  limit: {
    context: number;
    output: number;
  };
  modalities: {
    input: string[];
    output: string[];
  };
  knowledge: string;
  openWeights: boolean;
};

export type ModelMetadataResponse = Record<
  string,
  {
    id: string;
    name: string;
    description: string;
    release_date: string;
    last_updated: string;
    tool_call: boolean;
    structured_output: boolean;
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    top_p: boolean;
    streaming: boolean;
    open_weights: boolean;
    knowledge: string;
    limit: { context: number; output: number };
    modalities: { input: string[]; output: string[] };
  }
>;

export type ModelCatalogResponse = Record<
  string,
  {
    name: string;
    api: string;
    models: ModelMetadataResponse;
  }
>;
