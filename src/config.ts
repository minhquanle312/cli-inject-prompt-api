import type { ServerConfig } from "./types.js";

const weakApiKeys = new Set([
  "api-key",
  "change-me",
  "changeme",
  "password",
  "replace-me",
  "secret",
  "test",
  "test-api-key",
]);
const minApiKeyLength = 16;

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readApiKey(): string {
  const value = process.env.API_KEY?.trim() || "";
  if (value === "") throw new Error("API_KEY is required");
  if (weakApiKeys.has(value.toLowerCase()))
    throw new Error("API_KEY must not use a placeholder value");
  if (value.length < minApiKeyLength)
    throw new Error(`API_KEY must be at least ${minApiKeyLength} characters`);
  return value;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: readInteger("PORT", 3322),
    apiKey: readApiKey(),
    globalConcurrency: readInteger("GLOBAL_CONCURRENCY", 4),
    maxQueue: readInteger("MAX_QUEUE", 20),
    defaultTimeoutMs: readInteger("TIMEOUT_MS", 300_000),
  };
}
