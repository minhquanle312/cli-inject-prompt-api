import { spawn } from "node:child_process";
import type { CommandOutputEvent, CommandResult, RunCommandInput } from "./types.js";

const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

function emitOutput(input: RunCommandInput, event: CommandOutputEvent): void {
  if (event.text.length === 0) return;
  try {
    input.onOutput?.(event);
  } catch {
    // Output observers must not affect command execution.
  }
}

export function runCommand(input: RunCommandInput): Promise<CommandResult> {
  return new Promise((resolve) => {
    const args = input.promptTransport === "argument" ? [...input.args, input.prompt] : input.args;
    const child = spawn(input.command, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1_000).unref();
    }, input.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      emitOutput(input, { stream: "stdout", text: stripAnsi(chunk.toString("utf8")) });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      emitOutput(input, { stream: "stderr", text: stripAnsi(chunk.toString("utf8")) });
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        kind: "spawn_error",
        message: error.message,
        stdout: stripAnsi(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: stripAnsi(Buffer.concat(stderrChunks).toString("utf8")),
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      const stdout = stripAnsi(Buffer.concat(stdoutChunks).toString("utf8"));
      const stderr = stripAnsi(Buffer.concat(stderrChunks).toString("utf8"));
      if (timedOut) {
        finish({ ok: false, kind: "timeout", message: `Command timed out after ${input.timeoutMs}ms`, stdout, stderr, exitCode: code });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, kind: "nonzero_exit", message: `Command exited with code ${code ?? "unknown"}`, stdout, stderr, exitCode: code });
        return;
      }
      finish({ ok: true, stdout, stderr, exitCode: 0 });
    });

    if (input.promptTransport === "stdin") child.stdin.end(input.prompt);
    else child.stdin.end();
  });
}
