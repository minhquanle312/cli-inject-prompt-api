import assert from "node:assert/strict";
import test from "node:test";
import { getAdapter } from "../src/adapters.js";
import { listModels } from "../src/models.js";
import { buildModelsResponse } from "../src/openai.js";

test("registry exposes supported models", () => {
  assert.deepEqual(listModels().map((adapter) => adapter.id), [
    "gemini-3.5-flash",
    "kimi-k2.5",
    "kimi-k2.6",
    "minimax-m2.7",
    "glm-5.1",
  ]);
});

test("gemini adapter uses agy without model flag", () => {
  const adapter = getAdapter("gemini-3.5-flash");
  assert.equal(adapter?.command, "agy");
  assert.deepEqual(adapter?.args, ["-p"]);
  assert.equal(adapter?.promptTransport, "argument");
});

test("models response is OpenAI-compatible list", () => {
  const body = buildModelsResponse(123);
  assert.deepEqual(body, {
    object: "list",
    data: [
      { id: "gemini-3.5-flash", object: "model", created: 123, owned_by: "agy" },
      { id: "kimi-k2.5", object: "model", created: 123, owned_by: "cmd" },
      { id: "kimi-k2.6", object: "model", created: 123, owned_by: "cmd" },
      { id: "minimax-m2.7", object: "model", created: 123, owned_by: "cmd" },
      { id: "glm-5.1", object: "model", created: 123, owned_by: "cmd" },
    ],
  });
});
