import assert from "node:assert/strict";
import test from "node:test";
import { runCommand, stripAnsi } from "../src/runner.js";

const node = process.execPath;

test("stripAnsi removes terminal color sequences", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");
});

test("runner sends prompt to stdin and captures stdout", async () => {
  const result = await runCommand({
    command: node,
    args: ["-e", "process.stdin.on('data', c => process.stdout.write('ok:' + c.toString()))"],
    promptTransport: "stdin",
    prompt: "hello",
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.stdout, "ok:hello");
});

test("runner reports stdout and stderr incrementally", async () => {
  const events: string[] = [];
  const result = await runCommand({
    command: node,
    args: ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
    promptTransport: "stdin",
    prompt: "",
    timeoutMs: 5_000,
    onOutput: (event) => events.push(`${event.stream}:${event.text}`),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events.sort(), ["stderr:err", "stdout:out"]);
});

test("runner sends prompt as command argument", async () => {
  const result = await runCommand({
    command: node,
    args: ["-e", "process.stdout.write('ok:' + process.argv[1])"],
    promptTransport: "argument",
    prompt: "hello",
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.stdout, "ok:hello");
});

test("runner reports nonzero exit with stderr", async () => {
  const result = await runCommand({
    command: node,
    args: ["-e", "console.error('bad'); process.exit(7)"],
    promptTransport: "stdin",
    prompt: "",
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "nonzero_exit");
    assert.equal(result.exitCode, 7);
    assert.equal(result.stderr.trim(), "bad");
  }
});

test("runner times out hanging process", async () => {
  const result = await runCommand({
    command: node,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    promptTransport: "stdin",
    prompt: "",
    timeoutMs: 50,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "timeout");
});
