import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPromptInjectTool } from "../dist/prompt-inject-tool.js"
import server from "../dist/index.js"

function createContext(directory) {
  const metadataCalls = []

  return {
    metadataCalls,
    context: {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "sisyphus",
      directory,
      worktree: directory,
      abort: new AbortController().signal,
      metadata(input) {
        metadataCalls.push(input)
      },
      async ask() {},
    },
  }
}

const config = {
  version: 1,
  targets: {
    agy: {
      command: "agy",
      args_before_prompt: ["-p"],
      args_after_prompt: [],
    },
    cmd: {
      command: "cmd",
      args_before_prompt: ["--prompt"],
      args_after_prompt: [],
    },
  },
}

test("tool input validation rejects blank prompt", async () => {
  const toolDefinition = createPromptInjectTool(config, {
    runner: async () => {
      throw new Error("runner should not be called")
    },
  })

  const parsed = toolDefinition.args.prompt.safeParse("   ")
  assert.equal(parsed.success, false)
})

test("tool returns structured output and preserves stderr metadata", async () => {
  const toolDefinition = createPromptInjectTool(config, {
    runner: async () => ({
      target: "agy",
      ok: false,
      content: "",
      stderr: "cli warning",
      exit_code: 9,
      duration_ms: 12,
      empty_stdout: true,
      timed_out: false,
      command: 'agy -p "[REDACTED]"',
    }),
  })

  const { context, metadataCalls } = createContext(process.cwd())
  const result = await toolDefinition.execute({ target: "agy", prompt: "prompt" }, context)

  assert.equal(result.title, "prompt_inject failed")
  assert.match(result.output, /"target": "agy"/)
  assert.equal(result.metadata.stderr, "cli warning")
  assert.equal(metadataCalls[0]?.title, "prompt_inject")
})

test("unknown target is rejected with stable message", async () => {
  const toolDefinition = createPromptInjectTool(config, {
    runner: async () => {
      throw new Error("runner should not be called")
    },
  })

  const { context } = createContext(process.cwd())
  await assert.rejects(
    () => toolDefinition.execute({ target: "missing", prompt: "prompt" }, context),
    /unknown target: missing/,
  )
})

test("working_directory resolves relative to tool context directory", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-${Date.now()}`)
  const nested = join(sandbox, "nested")
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, "marker.txt"), "ok", "utf8")

  let receivedCwd = ""
  let receivedTarget = ""
  const toolDefinition = createPromptInjectTool(config, {
    runner: async (input) => {
      receivedCwd = input.cwd
      receivedTarget = input.target
      return {
        target: input.target,
        ok: true,
        content: "done",
        stderr: "",
        exit_code: 0,
        duration_ms: 1,
        empty_stdout: false,
        timed_out: false,
        command: 'cmd --prompt "[REDACTED]"',
      }
    },
  })

  const { context } = createContext(sandbox)
  await toolDefinition.execute({ target: "cmd", prompt: "prompt", working_directory: "nested" }, context)

  assert.equal(receivedCwd, nested)
  assert.equal(receivedTarget, "cmd")
})

test("working_directory rejects escaping outside tool context directory", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-${Date.now()}-escape`)
  const outside = join(tmpdir(), `prompt-inject-${Date.now()}-outside`)
  await mkdir(sandbox, { recursive: true })
  await mkdir(outside, { recursive: true })

  const toolDefinition = createPromptInjectTool(config, {
    runner: async () => ({
      target: "agy",
      ok: true,
      content: "done",
      stderr: "",
      exit_code: 0,
      duration_ms: 1,
      empty_stdout: false,
      timed_out: false,
      command: 'agy -p "[REDACTED]"',
    }),
  })

  const { context } = createContext(sandbox)
  await assert.rejects(
    () => toolDefinition.execute({ target: "agy", prompt: "prompt", working_directory: outside }, context),
    /must stay within the tool context directory/,
  )
})

test("plugin registers exactly one prompt_inject tool", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-plugin-${Date.now()}`)
  await mkdir(sandbox, { recursive: true })
  await writeFile(
    join(sandbox, "prompt-inject.json"),
    JSON.stringify(config),
    "utf8",
  )

  const plugin = await server({ directory: sandbox }, { config_path: "./prompt-inject.json" })
  assert.deepEqual(Object.keys(plugin.tool ?? {}), ["prompt_inject"])
})
