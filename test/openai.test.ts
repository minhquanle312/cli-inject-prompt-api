import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionChunks, buildChatCompletionResponse, parseChatCompletionRequest } from "../src/openai.js";
import { buildPrompt } from "../src/prompt.js";

test("parser accepts stream true", () => {
  const parsed = parseChatCompletionRequest({ model: "gemini-3.5-flash", stream: true, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(parsed, { model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }], stream: true });
});

test("parser accepts known model and string messages", () => {
  const parsed = parseChatCompletionRequest({ model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(parsed, { model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }], stream: false });
});

test("prompt formatter preserves role order", () => {
  assert.equal(buildPrompt([{ role: "system", content: "rules" }, { role: "user", content: "hi" }]), "System:\nrules\n\nUser:\nhi\n\nAssistant:");
});

test("completion response wraps stdout", () => {
  const body = buildChatCompletionResponse("gemini-3.5-flash", { ok: true, stdout: "hello\n", stderr: "", exitCode: 0 }, 123);
  assert.deepEqual(body, {
    id: "chatcmpl-local-123",
    object: "chat.completion",
    created: 123,
    model: "gemini-3.5-flash",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
});

test("stream chunks wrap stdout and finish", () => {
  const chunks = buildChatCompletionChunks("gemini-3.5-flash", { ok: true, stdout: "hello\n", stderr: "", exitCode: 0 }, 123);
  assert.deepEqual(chunks, [
    {
      id: "chatcmpl-local-123",
      object: "chat.completion.chunk",
      created: 123,
      model: "gemini-3.5-flash",
      choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }],
    },
    {
      id: "chatcmpl-local-123",
      object: "chat.completion.chunk",
      created: 123,
      model: "gemini-3.5-flash",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ]);
});
