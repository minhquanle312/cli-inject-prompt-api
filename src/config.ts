import type { ServerConfig } from "./types.js";

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST?.trim() || "127.0.0.1",
    port: readInteger("PORT", 3000),
    globalConcurrency: readInteger("GLOBAL_CONCURRENCY", 4),
    maxQueue: readInteger("MAX_QUEUE", 20),
    defaultTimeoutMs: readInteger("TIMEOUT_MS", 300_000),
  };
}
