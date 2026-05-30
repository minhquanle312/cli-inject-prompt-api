import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as unknown[];
}

import type { ServerConfig } from "../src/types.js";

const config: ServerConfig = { host: "127.0.0.1", port: 0, apiKey: "test-api-key-secret", globalConcurrency: 4, maxQueue: 20, defaultTimeoutMs: 300_000 };

const authHeaders = { authorization: `Bearer ${config.apiKey}` };

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createApp(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
  }
}

test("GET /v1/models returns model list", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders });
    assert.equal(response.status, 200);
    const body = record(await response.json());
    assert.equal(body.object, "list");
    const data = array(body.data);
    assert.equal(data.length, 5);
  });
});

test("POST /v1/chat/completions rejects streaming before spawning backend", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ model: "gemini-3.5-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(response.status, 400);
    const body = record(await response.json());
    const error = record(body.error);
    assert.equal(error.code, "unsupported_stream");
  });
});

test("unknown route returns JSON 404", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`, { headers: authHeaders });
    assert.equal(response.status, 404);
    const body = record(await response.json());
    const error = record(body.error);
    assert.equal(error.code, "not_found");
  });
});

test("requests without bearer token are rejected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models`);
    assert.equal(response.status, 401);
    const body = record(await response.json());
    const error = record(body.error);
    assert.equal(error.code, "unauthorized");
  });
});

test("requests with wrong bearer token are rejected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: "Bearer wrong-token-secret" } });
    assert.equal(response.status, 401);
    const body = record(await response.json());
    const error = record(body.error);
    assert.equal(error.code, "unauthorized");
  });
});

test("requests with bearer token are accepted", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders });
    assert.equal(response.status, 200);
  });
});

test("createApp rejects missing API key", () => {
  assert.throws(() => createApp({ ...config, apiKey: "" }), /API_KEY is required/);
});

test("loadConfig rejects missing API_KEY", () => {
  const previous = process.env.API_KEY;
  delete process.env.API_KEY;
  try {
    assert.throws(() => loadConfig(), /API_KEY is required/);
  } finally {
    if (previous === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previous;
  }
});

test("loadConfig rejects weak API_KEY values", () => {
  const previous = process.env.API_KEY;
  process.env.API_KEY = "change-me";
  try {
    assert.throws(() => loadConfig(), /API_KEY must not use a placeholder value/);
  } finally {
    if (previous === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = previous;
  }
});
