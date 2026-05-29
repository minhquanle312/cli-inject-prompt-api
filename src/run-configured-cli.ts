import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import { spawn } from "node:child_process"
import type { PromptInjectTargetConfig } from "./config.js"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000

export type RunConfiguredCliInput = {
  target: string
  targetConfig: PromptInjectTargetConfig
  prompt: string
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
  path?: string
}

export type PromptInjectExecutionResult = {
  target: string
  ok: boolean
  content: string
  stderr: string
  exit_code: number | null
  duration_ms: number
  empty_stdout: boolean
  timed_out: boolean
  command: string
}

export type SpawnLike = typeof spawn

export type RunConfiguredCliDependencies = {
  spawn?: SpawnLike
  now?: () => number
  findExecutableOnPath?: (command: string, pathValue?: string) => Promise<string | null>
}

export function normalizeTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`)
  }
  return timeoutMs
}

export async function findExecutableOnPath(
  command: string,
  pathValue = process.env.PATH ?? "",
): Promise<string | null> {
  if (!command.trim()) return null
  if (command.includes("/") && !isAbsolute(command)) {
    throw new Error("target command must be a bare executable name or absolute path")
  }

  if (isAbsolute(command)) {
    try {
      await access(command, constants.X_OK)
      return command
    } catch {
      return null
    }
  }

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, command)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

function redactCommand(targetConfig: PromptInjectTargetConfig): string {
  const parts = [
    targetConfig.command,
    ...targetConfig.args_before_prompt,
    '"[REDACTED]"',
    ...targetConfig.args_after_prompt,
  ]
  return parts.join(" ")
}

export async function runConfiguredCliPrompt(
  input: RunConfiguredCliInput,
  dependencies: RunConfiguredCliDependencies = {},
): Promise<PromptInjectExecutionResult> {
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs)
  const pathValue = input.path ?? process.env.PATH ?? ""
  const now = dependencies.now ?? (() => Date.now())
  const start = now()
  const resolveExecutable = dependencies.findExecutableOnPath ?? findExecutableOnPath
  const spawnProcess = dependencies.spawn ?? spawn
  const command = redactCommand(input.targetConfig)

  const executable = await resolveExecutable(input.targetConfig.command, pathValue)
  if (!executable) {
    return {
      target: input.target,
      ok: false,
      content: "",
      stderr: `${input.targetConfig.command} binary not found on PATH`,
      exit_code: null,
      duration_ms: now() - start,
      empty_stdout: true,
      timed_out: false,
      command,
    }
  }

  const argv = [
    ...input.targetConfig.args_before_prompt,
    input.prompt,
    ...input.targetConfig.args_after_prompt,
  ]

  return await new Promise<PromptInjectExecutionResult>((resolve) => {
    const child = spawnProcess(executable, argv, {
      cwd: input.cwd,
      shell: false,
      signal: input.signal,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)

      const trimmedStdout = stdout.trim()
      const trimmedStderr = stderr.trim()
      const emptyStdout = trimmedStdout.length === 0
      const ok = !timedOut && exitCode === 0 && !emptyStdout

      resolve({
        target: input.target,
        ok,
        content: trimmedStdout,
        stderr: trimmedStderr,
        exit_code: exitCode,
        duration_ms: now() - start,
        empty_stdout: emptyStdout,
        timed_out: timedOut,
        command,
      })
    }

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.on("error", (error) => {
      if (settled) return
      stderr = [stderr, error.message].filter(Boolean).join("\n").trim()
      finish(null)
    })

    child.on("close", (code) => {
      finish(code)
    })

    timeoutHandle = setTimeout(() => {
      if (settled) return
      timedOut = true
      stderr = [stderr, `Process timed out after ${timeoutMs}ms`].filter(Boolean).join("\n").trim()
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL")
        }
      }, 1_000).unref()
    }, timeoutMs)

    timeoutHandle.unref()
  })
}
