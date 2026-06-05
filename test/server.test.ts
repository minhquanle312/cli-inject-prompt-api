import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("GET /healthz returns ok without bearer token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    const body = record(await response.json());
    assert.equal(body.status, "ok");
  });
});

test("POST /healthz rejects invalid method without bearer token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`, { method: "POST" });
    assert.equal(response.status, 405);
    const body = record(await response.json());
    const error = record(body.error);
    assert.equal(error.code, "method_not_allowed");
  });
});

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

test("GET /v1/models/metadata returns rich model metadata", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models/metadata`, { headers: authHeaders });
    assert.equal(response.status, 200);
    const body = record(await response.json());
    const gemini = record(body["gemini-3.5-flash"]);
    assert.equal(gemini.tool_call, true);
    assert.equal(gemini.structured_output, true);
  });
});

test("GET /v1/models/catalog returns models.dev-like provider catalog", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models/catalog`, { headers: authHeaders });
    assert.equal(response.status, 200);
    const body = record(await response.json());
    const agy = record(body.agy);
    assert.equal(typeof agy.api, "string");
    const models = record(agy.models);
    assert.equal(record(models["gemini-3.5-flash"]).tool_call, true);
  });
});

test("POST /v1/chat/completions returns SSE when stream is true", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream; charset=utf-8/);
      assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      const body = await response.text();
      assert.match(body, /^:\n\n/);
      assert.match(body, /^data: \{"id":"chatcmpl-local-\d+","object":"chat\.completion\.chunk"/m);
      assert.match(body, /"delta":\{"role":"assistant"\}/);
      assert.match(body, /"delta":\{"content":"hi"\}/);
      assert.match(body, /"finish_reason":"stop"/);
      assert.match(body, /data: \[DONE\]/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/chat/completions honors Accept: text/event-stream when stream is omitted", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }] }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream; charset=utf-8/);
      const body = await response.text();
      assert.match(body, /"delta":\{"role":"assistant"\}/);
      assert.match(body, /data: \[DONE\]/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/chat/completions keeps explicit stream false even when Accept requests SSE", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", stream: false, messages: [{ role: "user", content: "hi" }] }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json; charset=utf-8/);
      const body = record(await response.json());
      const choices = array(body.choices);
      const choice = record(choices[0]);
      const message = record(choice.message);
      assert.equal(message.content, "hi");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/chat/completions streams stderr terminal output", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'thinking' >&2\nprintf 'answer'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", stream: true, messages: [{ role: "user", content: "hi" }] }),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /\[stderr\] thinking/);
      assert.match(body, /"content":"answer"/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/responses returns OpenAI Responses shape", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", input: "hi" }),
      });
      assert.equal(response.status, 200);
      const body = record(await response.json());
      assert.equal(body.object, "response");
      assert.equal(body.status, "completed");
      const output = array(body.output);
      const item = record(output[0]);
      assert.equal(item.type, "message");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/chat/completions returns tool_calls when cli emits tool json", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf '%s' '{\"type\":\"tool_calls\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":\\\"hi\\\"}\"}}]}'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: "gemini-3.5-flash",
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "lookup" } }],
        }),
      });
      assert.equal(response.status, 200);
      const body = record(await response.json());
      const choices = array(body.choices);
      const choice = record(choices[0]);
      assert.equal(choice.finish_reason, "tool_calls");
      const message = record(choice.message);
      assert.equal(message.content, null);
      assert.equal(Array.isArray(message.tool_calls), true);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/responses returns function_call items when cli emits tool json", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf '%s' '{\"type\":\"tool_calls\",\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":\\\"hi\\\"}\"}}]}'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: "gemini-3.5-flash",
          input: "hi",
          tools: [{ type: "function", function: { name: "lookup" } }],
        }),
      });
      assert.equal(response.status, 200);
      const body = record(await response.json());
      const output = array(body.output);
      const item = record(output[0]);
      assert.equal(item.type, "function_call");
      assert.equal(item.name, "lookup");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/responses streams response events", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", input: "hi", stream: true }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream; charset=utf-8/);
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      const body = await response.text();
      assert.match(body, /^:\n\n/);
      assert.match(body, /"type":"response\.created"/);
      assert.match(body, /"type":"response\.output_text\.delta".*"delta":"hi"/);
      assert.match(body, /"type":"response\.completed"/);
      assert.match(body, /data: \[DONE\]/);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test("POST /v1/responses honors Accept: text/event-stream when stream is omitted", async () => {
  const originalPath = process.env.PATH;
  const shimDir = await mkdtemp(join(tmpdir(), "prompt-inject-opencode-"));
  const shimPath = join(shimDir, "agy");
  await writeFile(shimPath, "#!/bin/sh\nprintf 'hi'\n");
  await chmod(shimPath, 0o755);
  process.env.PATH = `${shimDir}:${originalPath ?? ""}`;
  await withServer(async (baseUrl) => {
    try {
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...authHeaders },
        body: JSON.stringify({ model: "gemini-3.5-flash", input: "hi" }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream; charset=utf-8/);
      const body = await response.text();
      assert.match(body, /"type":"response\.created"/);
      assert.match(body, /data: \[DONE\]/);
    } finally {
      process.env.PATH = originalPath;
    }
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
