import type { AdapterConfig, ModelCatalogResponse, ModelId, ModelMetadataResponse, ModelRegistryEntry } from "./types.js";

export const modelRegistry = {
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    provider: "agy",
    name: "Gemini 3.5 Flash",
    command: "agy",
    args: ["-p"],
    promptTransport: "argument",
    timeoutMs: 300_000,
    concurrency: 1,
    description: "Fast Gemini-compatible CLI model exposed through agy.",
    releaseDate: "2026-06-05",
    lastUpdated: "2026-06-05",
    capabilities: {
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      topP: true,
      streaming: true,
    },
    limit: { context: 1_000_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    knowledge: "workspace-and-remote",
    openWeights: false,
  },
  "kimi-k2.5": {
    id: "kimi-k2.5",
    provider: "cmd",
    name: "Kimi K2.5",
    command: "cmd",
    args: ["-p", "--model", "moonshotai/Kimi-K2.5"],
    promptTransport: "stdin",
    timeoutMs: 300_000,
    concurrency: 1,
    description: "Moonshot Kimi model routed through cmd.",
    releaseDate: "2026-06-05",
    lastUpdated: "2026-06-05",
    capabilities: {
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      topP: true,
      streaming: true,
    },
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    knowledge: "workspace-and-remote",
    openWeights: false,
  },
  "kimi-k2.6": {
    id: "kimi-k2.6",
    provider: "cmd",
    name: "Kimi K2.6",
    command: "cmd",
    args: ["-p", "--model", "moonshotai/Kimi-K2.6"],
    promptTransport: "stdin",
    timeoutMs: 300_000,
    concurrency: 1,
    description: "Moonshot Kimi model routed through cmd.",
    releaseDate: "2026-06-05",
    lastUpdated: "2026-06-05",
    capabilities: {
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      topP: true,
      streaming: true,
    },
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    knowledge: "workspace-and-remote",
    openWeights: false,
  },
  "minimax-m2.7": {
    id: "minimax-m2.7",
    provider: "cmd",
    name: "MiniMax M2.7",
    command: "cmd",
    args: ["-p", "--model", "MiniMaxAI/MiniMax-M2.7"],
    promptTransport: "stdin",
    timeoutMs: 300_000,
    concurrency: 1,
    description: "MiniMax model routed through cmd.",
    releaseDate: "2026-06-05",
    lastUpdated: "2026-06-05",
    capabilities: {
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      topP: true,
      streaming: true,
    },
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    knowledge: "workspace-and-remote",
    openWeights: false,
  },
  "glm-5.1": {
    id: "glm-5.1",
    provider: "cmd",
    name: "GLM 5.1",
    command: "cmd",
    args: ["-p", "--model", "zai-org/GLM-5.1"],
    promptTransport: "stdin",
    timeoutMs: 300_000,
    concurrency: 1,
    description: "GLM model routed through cmd.",
    releaseDate: "2026-06-05",
    lastUpdated: "2026-06-05",
    capabilities: {
      toolCall: true,
      structuredOutput: true,
      reasoning: true,
      attachment: true,
      temperature: true,
      topP: true,
      streaming: true,
    },
    limit: { context: 128_000, output: 8_192 },
    modalities: { input: ["text", "image"], output: ["text"] },
    knowledge: "workspace-and-remote",
    openWeights: false,
  },
} as const satisfies Record<ModelId, ModelRegistryEntry>;

export function getModel(model: string): ModelRegistryEntry | undefined {
  return Object.values(modelRegistry).find((entry) => entry.id === model);
}

export function listModels(): ModelRegistryEntry[] {
  return Object.values(modelRegistry);
}

export function toAdapter(entry: ModelRegistryEntry): AdapterConfig {
  return {
    id: entry.id,
    command: entry.command,
    args: entry.args,
    promptTransport: entry.promptTransport,
    timeoutMs: entry.timeoutMs,
    concurrency: entry.concurrency,
  };
}

export function buildModelMetadata(): ModelMetadataResponse {
  return Object.fromEntries(
    listModels().map((entry) => [
      entry.id,
      {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        release_date: entry.releaseDate,
        last_updated: entry.lastUpdated,
        tool_call: entry.capabilities.toolCall,
        structured_output: entry.capabilities.structuredOutput,
        reasoning: entry.capabilities.reasoning,
        attachment: entry.capabilities.attachment,
        temperature: entry.capabilities.temperature,
        top_p: entry.capabilities.topP,
        streaming: entry.capabilities.streaming,
        open_weights: entry.openWeights,
        knowledge: entry.knowledge,
        limit: entry.limit,
        modalities: entry.modalities,
      },
    ]),
  );
}

export function buildModelCatalog(baseUrl: string): ModelCatalogResponse {
  const grouped = new Map<string, ModelCatalogResponse[string]>();
  for (const entry of listModels()) {
    const provider = grouped.get(entry.provider) ?? {
      name: entry.provider.toUpperCase(),
      api: `${baseUrl}/v1`,
      models: {},
    };
    provider.models[entry.id] = {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      release_date: entry.releaseDate,
      last_updated: entry.lastUpdated,
      tool_call: entry.capabilities.toolCall,
      structured_output: entry.capabilities.structuredOutput,
      reasoning: entry.capabilities.reasoning,
      attachment: entry.capabilities.attachment,
      temperature: entry.capabilities.temperature,
      top_p: entry.capabilities.topP,
      streaming: entry.capabilities.streaming,
      open_weights: entry.openWeights,
      knowledge: entry.knowledge,
      limit: entry.limit,
      modalities: entry.modalities,
    };
    grouped.set(entry.provider, provider);
  }
  return Object.fromEntries(grouped);
}
