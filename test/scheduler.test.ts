import assert from "node:assert/strict";
import test from "node:test";
import { Scheduler, QueueFullError } from "../src/scheduler.js";
import type { AdapterConfig, CommandResult, ModelId, RunCommandInput } from "../src/types.js";

function adapter(id: ModelId): AdapterConfig {
  return { id, command: id, args: [], timeoutMs: 1000, concurrency: 1 };
}

test("scheduler serializes same model", async () => {
  let running = 0;
  let maxRunning = 0;
  const scheduler = new Scheduler(4, 20, async (): Promise<CommandResult> => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running -= 1;
    return { ok: true, stdout: "ok", stderr: "", exitCode: 0 };
  });
  await Promise.all([scheduler.enqueue(adapter("kimi-k2.5"), "a"), scheduler.enqueue(adapter("kimi-k2.5"), "b")]);
  assert.equal(maxRunning, 1);
});

test("scheduler runs different models concurrently", async () => {
  const started: string[] = [];
  const scheduler = new Scheduler(4, 20, async (input: RunCommandInput): Promise<CommandResult> => {
    started.push(input.command);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, stdout: "ok", stderr: "", exitCode: 0 };
  });
  await Promise.all([scheduler.enqueue(adapter("kimi-k2.5"), "a"), scheduler.enqueue(adapter("glm-5.1"), "b")]);
  assert.deepEqual(started.sort(), ["glm-5.1", "kimi-k2.5"]);
});

test("scheduler rejects when waiting queue is full", async () => {
  const scheduler = new Scheduler(1, 1, async (): Promise<CommandResult> => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ok: true, stdout: "ok", stderr: "", exitCode: 0 };
  });
  const same = adapter("kimi-k2.5");
  const first = scheduler.enqueue(same, "a");
  const second = scheduler.enqueue(same, "b");
  await assert.rejects(() => scheduler.enqueue(same, "c"), QueueFullError);
  await Promise.all([first, second]);
});
