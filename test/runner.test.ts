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
    prompt: "",
    timeoutMs: 50,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, "timeout");
});
