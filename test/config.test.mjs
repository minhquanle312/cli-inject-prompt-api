import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  loadPromptInjectConfig,
  parsePluginOptions,
  resolveConfigPath,
  validatePromptInjectConfig,
} from "../dist/config.js"
import server from "../dist/index.js"

test("plugin options require only non-empty config_path", () => {
  assert.throws(() => parsePluginOptions(undefined), /must be an object/)
  assert.throws(() => parsePluginOptions({}), /contain only config_path/)
  assert.throws(() => parsePluginOptions({ config_path: "", extra: true }), /contain only config_path/)
  assert.deepEqual(parsePluginOptions({ config_path: " ./prompt-inject.json " }), {
    config_path: "./prompt-inject.json",
  })
})

test("resolveConfigPath resolves relative paths from plugin directory", () => {
  assert.equal(resolveConfigPath("/repo", "config/prompt-inject.json"), "/repo/config/prompt-inject.json")
  assert.equal(resolveConfigPath("/repo", "/tmp/config.json"), "/tmp/config.json")
})

test("validatePromptInjectConfig rejects invalid shapes", () => {
  assert.throws(() => validatePromptInjectConfig(null), /JSON object/)
  assert.throws(() => validatePromptInjectConfig({ version: 2, targets: {} }), /version must be 1/)
  assert.throws(() => validatePromptInjectConfig({ version: 1, targets: {} }), /at least one CLI target/)
  assert.throws(
    () => validatePromptInjectConfig({ version: 1, targets: { "Bad Name": { command: "agy", args_before_prompt: [] } } }),
    /invalid target name/,
  )
  assert.throws(
    () => validatePromptInjectConfig({ version: 1, targets: { agy: { command: "", args_before_prompt: [] } } }),
    /command must be a non-empty string/,
  )
})

test("loadPromptInjectConfig reads and validates JSON file", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-config-${Date.now()}`)
  await mkdir(sandbox, { recursive: true })
  await writeFile(
    join(sandbox, "prompt-inject.json"),
    JSON.stringify({ version: 1, targets: { agy: { command: "agy", args_before_prompt: ["-p"] } } }),
    "utf8",
  )

  const loaded = await loadPromptInjectConfig(sandbox, { config_path: "./prompt-inject.json" })
  assert.equal(loaded.configPath, join(sandbox, "prompt-inject.json"))
  assert.equal(loaded.config.targets.agy.command, "agy")
  assert.deepEqual(loaded.config.targets.agy.args_after_prompt, [])
})

test("loadPromptInjectConfig rejects unreadable and invalid JSON files", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-bad-${Date.now()}`)
  await mkdir(sandbox, { recursive: true })

  await assert.rejects(
    () => loadPromptInjectConfig(sandbox, { config_path: "./missing.json" }),
    /does not exist or is not readable/,
  )

  await writeFile(join(sandbox, "invalid.json"), "{not json", "utf8")
  await assert.rejects(
    () => loadPromptInjectConfig(sandbox, { config_path: "./invalid.json" }),
    /must be valid JSON/,
  )
})

test("plugin init fails fast when config is invalid", async () => {
  const sandbox = join(tmpdir(), `prompt-inject-plugin-${Date.now()}`)
  await mkdir(sandbox, { recursive: true })
  await writeFile(join(sandbox, "prompt-inject.json"), JSON.stringify({ version: 1, targets: {} }), "utf8")

  await assert.rejects(
    () => server({ directory: sandbox }, { config_path: "./prompt-inject.json" }),
    /at least one CLI target/,
  )
})
