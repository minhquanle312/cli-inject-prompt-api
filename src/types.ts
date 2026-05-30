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

export type ChatRole = "system" | "user" | "assistant" | "developer";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletionRequest = {
  model: ModelId;
  messages: ChatMessage[];
  stream?: false;
};

export type RunCommandInput = {
  command: string;
  args: readonly string[];
  promptTransport: "stdin" | "argument";
  prompt: string;
  timeoutMs: number;
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
