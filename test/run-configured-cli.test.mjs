import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"

import { normalizeTimeoutMs, runConfiguredCliPrompt } from "../dist/run-configured-cli.js"

class FakeReadable extends EventEmitter {
  setEncoding() {}
}

class FakeChildProcess extends EventEmitter {
  constructor() {
    super()
    this.stdout = new FakeReadable()
    this.stderr = new FakeReadable()
    this.kills = []
  }

  kill(signal) {
    this.kills.push(signal)
    return true
  }
}

function createSpawnHarness(setup) {
  const calls = []

  return {
    calls,
    spawn(command, args, options) {
      const child = new FakeChildProcess()
      calls.push({ command, args, options, child })
      setup(child, { command, args, options })
      return child
    },
  }
}

const targetConfig = {
  command: "agy",
  args_before_prompt: ["-p"],
  args_after_prompt: ["--json"],
}

test("success case returns structured success output", async () => {
  const harness = createSpawnHarness((child) => {
    queueMicrotask(() => {
      child.stdout.emit("data", "hello from cli\n")
      child.stderr.emit("data", "debug line\n")
      child.emit("close", 0)
    })
  })

  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "say hello", cwd: "/tmp" },
    {
      spawn: harness.spawn,
      findExecutableOnPath: async () => "/usr/bin/agy",
    },
  )

  assert.equal(result.target, "agy")
  assert.equal(result.ok, true)
  assert.equal(result.content, "hello from cli")
  assert.equal(result.stderr, "debug line")
  assert.equal(result.exit_code, 0)
  assert.equal(result.empty_stdout, false)
  assert.equal(result.timed_out, false)
  assert.equal(result.command, 'agy -p "[REDACTED]" --json')
  assert.equal(harness.calls[0]?.command, "/usr/bin/agy")
  assert.deepEqual(harness.calls[0]?.args, ["-p", "say hello", "--json"])
  assert.equal(harness.calls[0]?.options.shell, false)
})

test("CLI missing from PATH returns explicit failure", async () => {
  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "missing", cwd: "/tmp", path: "" },
    { findExecutableOnPath: async () => null },
  )

  assert.equal(result.ok, false)
  assert.equal(result.exit_code, null)
  assert.equal(result.command, 'agy -p "[REDACTED]" --json')
  assert.match(result.stderr, /agy binary not found on PATH/)
})

test("timeout kills process and marks timed_out", async () => {
  const harness = createSpawnHarness((child) => {
    setTimeout(() => {
      child.emit("close", null)
    }, 20).unref()
  })

  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "slow", cwd: "/tmp", timeoutMs: 5 },
    {
      spawn: harness.spawn,
      findExecutableOnPath: async () => "/usr/bin/agy",
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.timed_out, true)
  assert.equal(result.exit_code, null)
  assert.match(result.stderr, /timed out/i)
  assert.deepEqual(harness.calls[0]?.child.kills, ["SIGTERM"])
})

test("non-zero exit code returns explicit failure", async () => {
  const harness = createSpawnHarness((child) => {
    queueMicrotask(() => {
      child.stderr.emit("data", "bad request\n")
      child.emit("close", 2)
    })
  })

  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "fail", cwd: "/tmp" },
    {
      spawn: harness.spawn,
      findExecutableOnPath: async () => "/usr/bin/agy",
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.exit_code, 2)
  assert.equal(result.stderr, "bad request")
})

test("empty stdout with zero exit code is failure", async () => {
  const harness = createSpawnHarness((child) => {
    queueMicrotask(() => {
      child.stderr.emit("data", "warning only\n")
      child.emit("close", 0)
    })
  })

  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "no stdout", cwd: "/tmp" },
    {
      spawn: harness.spawn,
      findExecutableOnPath: async () => "/usr/bin/agy",
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.exit_code, 0)
  assert.equal(result.empty_stdout, true)
})

test("stderr preservation survives spawn error path", async () => {
  const harness = createSpawnHarness((child) => {
    queueMicrotask(() => {
      child.stderr.emit("data", "spawn failed\n")
      child.emit("error", new Error("ENOENT from spawn"))
    })
  })

  const result = await runConfiguredCliPrompt(
    { target: "agy", targetConfig, prompt: "broken", cwd: "/tmp" },
    {
      spawn: harness.spawn,
      findExecutableOnPath: async () => "/usr/bin/agy",
    },
  )

  assert.equal(result.ok, false)
  assert.equal(result.exit_code, null)
  assert.match(result.stderr, /spawn failed/)
  assert.match(result.stderr, /ENOENT from spawn/)
})

test("input validation rejects invalid timeout", () => {
  assert.throws(() => normalizeTimeoutMs(0), /timeout_ms must be an integer/)
  assert.throws(() => normalizeTimeoutMs(300_001), /timeout_ms must be an integer/)
})

test("relative commands with path separators are rejected", async () => {
  await assert.rejects(
    () => runConfiguredCliPrompt({ target: "bad", targetConfig: { command: "./agy", args_before_prompt: [], args_after_prompt: [] }, prompt: "x", cwd: "/tmp" }),
    /bare executable name or absolute path/,
  )
})
