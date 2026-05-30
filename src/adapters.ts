import type { AdapterConfig, ModelId } from "./types.js";

export const adapters = {
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    command: "agy",
    args: ["-p"],
    timeoutMs: 300_000,
    concurrency: 1,
  },
  "kimi-k2.5": {
    id: "kimi-k2.5",
    command: "cmd",
    args: ["-p", "--model", "moonshotai/Kimi-K2.5"],
    timeoutMs: 300_000,
    concurrency: 1,
  },
  "kimi-k2.6": {
    id: "kimi-k2.6",
    command: "cmd",
    args: ["-p", "--model", "moonshotai/Kimi-K2.6"],
    timeoutMs: 300_000,
    concurrency: 1,
  },
  "minimax-m2.7": {
    id: "minimax-m2.7",
    command: "cmd",
    args: ["-p", "--model", "MiniMaxAI/MiniMax-M2.7"],
    timeoutMs: 300_000,
    concurrency: 1,
  },
  "glm-5.1": {
    id: "glm-5.1",
    command: "cmd",
    args: ["-p", "--model", "zai-org/GLM-5.1"],
    timeoutMs: 300_000,
    concurrency: 1,
  },
} as const satisfies Record<ModelId, AdapterConfig>;

export function getAdapter(model: string): AdapterConfig | undefined {
  return Object.values(adapters).find((adapter) => adapter.id === model);
}

export function listModels(): AdapterConfig[] {
  return Object.values(adapters);
}
