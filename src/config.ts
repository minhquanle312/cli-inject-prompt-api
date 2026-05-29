import { readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

const TARGET_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export type PromptInjectPluginOptions = {
  config_path: string
}

export type PromptInjectTargetConfig = {
  command: string
  args_before_prompt: string[]
  args_after_prompt: string[]
}

export type PromptInjectConfig = {
  $schema?: string
  version: 1
  targets: Record<string, PromptInjectTargetConfig>
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message)
  }
}

function validateStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`)
  }

  const strings = value.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`${fieldName} must contain only non-empty strings`)
    }
    return entry
  })

  return strings
}

export function parsePluginOptions(options: unknown): PromptInjectPluginOptions {
  assertObject(options, "plugin options must be an object")

  const keys = Object.keys(options)
  if (keys.length !== 1 || !keys.includes("config_path")) {
    throw new Error("plugin options must contain only config_path")
  }

  const configPath = options.config_path
  if (typeof configPath !== "string" || configPath.trim().length === 0) {
    throw new Error("config_path must be a non-empty string")
  }

  return {
    config_path: configPath.trim(),
  }
}

export function resolveConfigPath(baseDirectory: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : resolve(baseDirectory, configPath)
}

export function validatePromptInjectConfig(value: unknown): PromptInjectConfig {
  assertObject(value, "config file must contain a JSON object")

  const allowedRootKeys = new Set(["$schema", "version", "targets"])
  for (const key of Object.keys(value)) {
    if (!allowedRootKeys.has(key)) {
      throw new Error(`config file contains unsupported root key: ${key}`)
    }
  }

  if (value.$schema !== undefined && typeof value.$schema !== "string") {
    throw new Error("$schema must be a string when provided")
  }

  if (value.version !== 1) {
    throw new Error("config version must be 1")
  }

  assertObject(value.targets, "targets must be an object")
  const entries = Object.entries(value.targets)

  if (entries.length === 0) {
    throw new Error("targets must define at least one CLI target")
  }

  const targets: Record<string, PromptInjectTargetConfig> = {}

  for (const [targetName, targetValue] of entries) {
    if (!TARGET_NAME_PATTERN.test(targetName)) {
      throw new Error(`invalid target name: ${targetName}`)
    }

    assertObject(targetValue, `target ${targetName} must be an object`)

    const allowedTargetKeys = new Set(["command", "args_before_prompt", "args_after_prompt"])
    for (const key of Object.keys(targetValue)) {
      if (!allowedTargetKeys.has(key)) {
        throw new Error(`target ${targetName} contains unsupported key: ${key}`)
      }
    }

    if (typeof targetValue.command !== "string" || targetValue.command.trim().length === 0) {
      throw new Error(`target ${targetName} command must be a non-empty string`)
    }

    targets[targetName] = {
      command: targetValue.command.trim(),
      args_before_prompt: validateStringArray(targetValue.args_before_prompt, `target ${targetName} args_before_prompt`),
      args_after_prompt:
        targetValue.args_after_prompt === undefined
          ? []
          : validateStringArray(targetValue.args_after_prompt, `target ${targetName} args_after_prompt`),
    }
  }

  const result: PromptInjectConfig = {
    version: 1,
    targets,
  }

  if (typeof value.$schema === "string") {
    result.$schema = value.$schema
  }

  return result
}

export async function loadPromptInjectConfig(
  baseDirectory: string,
  options: unknown,
): Promise<{ configPath: string; config: PromptInjectConfig }> {
  const parsedOptions = parsePluginOptions(options)
  const configPath = resolveConfigPath(baseDirectory, parsedOptions.config_path)

  let rawText: string
  try {
    rawText = await readFile(configPath, "utf8")
  } catch {
    throw new Error("config_path does not exist or is not readable")
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawText)
  } catch {
    throw new Error("config file must be valid JSON")
  }

  return {
    configPath,
    config: validatePromptInjectConfig(parsedJson),
  }
}
