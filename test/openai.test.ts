import assert from "node:assert/strict";
import test from "node:test";
import { buildChatCompletionResponse, buildResponsesResponse, parseAssistantOutput, parseChatCompletionRequest, parseResponsesRequest } from "../src/openai.js";
import { buildPrompt } from "../src/prompt.js";

test("parser accepts stream true", () => {
  const parsed = parseChatCompletionRequest({ model: "gemini-3.5-flash", stream: true, messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(parsed, { model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }], tools: [], stream: true });
});

test("parser accepts known model and string messages", () => {
  const parsed = parseChatCompletionRequest({ model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }] });
  assert.deepEqual(parsed, { model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi" }], tools: [], stream: false });
});

test("parser accepts text content parts", () => {
  const parsed = parseChatCompletionRequest({
    model: "gemini-3.5-flash",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "input_text", text: "there" }] }],
  });
  assert.deepEqual(parsed, { model: "gemini-3.5-flash", messages: [{ role: "user", content: "hi\nthere" }], tools: [], stream: false });
});

test("parser accepts tools and tool_choice", () => {
  const parsed = parseChatCompletionRequest({
    model: "gemini-3.5-flash",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    tool_choice: { type: "function", function: { name: "lookup" } },
  });
  assert.deepEqual(parsed, {
    model: "gemini-3.5-flash",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    toolChoice: { type: "function", function: { name: "lookup" } },
    stream: false,
  });
});

test("responses parser accepts string input and instructions", () => {
  const parsed = parseResponsesRequest({ model: "gemini-3.5-flash", instructions: "rules", input: "hi", stream: true });
  assert.deepEqual(parsed, {
    model: "gemini-3.5-flash",
    messages: [{ role: "system", content: "rules" }, { role: "user", content: "hi" }],
    tools: [],
    stream: true,
  });
});

test("prompt formatter injects workspace-agnostic schema and tagged user prompt", () => {
  const prompt = buildPrompt([{ role: "system", content: "rules" }, { role: "user", content: "hi" }], {
    tools: [{ type: "function", function: { name: "lookup" } }],
    toolChoice: "auto",
  });
  assert.match(prompt, /Treat every request as unrelated to the current workspace/);
  assert.match(prompt, /Paths such as \/app, \/workspace, \/root/);
  assert.match(prompt, /<user-prompt>hi<\/user-prompt>/);
  assert.match(prompt, /<tools>\[\{"type":"function","function":\{"name":"lookup"\}\}\]<\/tools>/);
  assert.match(prompt, /The only callable function names for this request are: lookup\./);
  assert.match(prompt, /Never invent a tool name, alias, synonym, or placeholder\./);
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

test("responses response wraps stdout", () => {
  const body = buildResponsesResponse("gemini-3.5-flash", { ok: true, stdout: "hello\n", stderr: "", exitCode: 0 }, 123);
  const response = body as { output: Array<{ content: Array<{ text: string }> }>; status: string; model: string };
  assert.equal(response.status, "completed");
  assert.equal(response.model, "gemini-3.5-flash");
  assert.equal(response.output[0]?.content[0]?.text, "hello");
});

test("assistant output parser converts tool call envelope", () => {
  const parsed = parseAssistantOutput('{"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"hello\\"}"}}]}');
  assert.deepEqual(parsed, {
    kind: "tool_calls",
    toolCalls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":"hello"}' } }],
  });
});

test("chat completion response exposes tool_calls when cli returns tool envelope", () => {
  const body = buildChatCompletionResponse(
    "gemini-3.5-flash",
    { ok: true, stdout: '{"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"hello\\"}"}}]}\n', stderr: "", exitCode: 0 },
    123,
  ) as { choices: Array<{ finish_reason: string; message: { content: string | null; tool_calls?: unknown[] } }> };
  assert.equal(body.choices[0]?.finish_reason, "tool_calls");
  assert.equal(body.choices[0]?.message.content, null);
  assert.equal(Array.isArray(body.choices[0]?.message.tool_calls), true);
});

test("responses response exposes function_call output when cli returns tool envelope", () => {
  const body = buildResponsesResponse(
    "gemini-3.5-flash",
    { ok: true, stdout: '{"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"hello\\"}"}}]}\n', stderr: "", exitCode: 0 },
    123,
  ) as { output: Array<{ type: string; name?: string; arguments?: string }> };
  assert.equal(body.output[0]?.type, "function_call");
  assert.equal(body.output[0]?.name, "lookup");
});
