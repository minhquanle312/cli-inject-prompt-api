import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { tool } from "@opencode-ai/plugin"
import type { PromptInjectConfig } from "./config.js"
import {
  normalizeTimeoutMs,
  runConfiguredCliPrompt,
  type PromptInjectExecutionResult,
  type RunConfiguredCliDependencies,
} from "./run-configured-cli.js"

export type PromptInjectArgs = {
  target: string
  prompt: string
  timeout_ms?: number
  working_directory?: string
}

type CreatePromptInjectToolDependencies = {
  runner?: typeof runConfiguredCliPrompt
} & RunConfiguredCliDependencies

function formatStructuredResult(result: PromptInjectExecutionResult) {
  return JSON.stringify(result, null, 2)
}

async function resolveWorkingDirectory(baseDirectory: string, candidate?: string): Promise<string> {
  if (!candidate) return baseDirectory

  const trimmed = candidate.trim()
  const resolved = isAbsolute(trimmed) ? trimmed : resolve(baseDirectory, trimmed)
  const relativePath = relative(baseDirectory, resolved)

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    (!relativePath && resolved !== baseDirectory)
  ) {
    throw new Error("working_directory must stay within the tool context directory")
  }

  let directoryStat
  try {
    directoryStat = await stat(resolved)
  } catch {
    throw new Error("working_directory does not exist or is not accessible")
  }

  if (!directoryStat.isDirectory()) {
    throw new Error("working_directory must point to a directory")
  }

  return resolved
}

export function createPromptInjectTool(
  config: PromptInjectConfig,
  dependencies: CreatePromptInjectToolDependencies = {},
) {
  const runner = dependencies.runner ?? ((input) => runConfiguredCliPrompt(input, dependencies))

  return tool({
    description: "Run a configured prompt CLI target and return structured execution output.",
    args: {
      target: tool.schema.string().trim().min(1, "target is required"),
      prompt: tool.schema.string().trim().min(1, "prompt is required"),
      timeout_ms: tool.schema.number().int().positive().max(300_000).optional(),
      working_directory: tool.schema.string().trim().min(1).optional(),
    },
    async execute(args, context) {
      const targetConfig = config.targets[args.target]
      if (!targetConfig) {
        throw new Error(`unknown target: ${args.target}`)
      }

      const timeoutMs = normalizeTimeoutMs(args.timeout_ms)
      const cwd = await resolveWorkingDirectory(context.directory, args.working_directory)

      const result = await runner({
        target: args.target,
        targetConfig,
        prompt: args.prompt,
        cwd,
        timeoutMs,
        signal: context.abort,
      })

      context.metadata({
        title: "prompt_inject",
        metadata: result,
      })

      return {
        title: result.ok ? "prompt_inject" : "prompt_inject failed",
        output: formatStructuredResult(result),
        metadata: result,
      }
    },
  })
}
