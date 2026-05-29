# prompt-inject-opencode

## Overview

`prompt-inject-opencode` is a standalone OpenCode plugin that registers one explicit tool: `prompt_inject`.

The plugin is vendor-neutral. Instead of hard-coding Antigravity CLI, it loads a required JSON config file that defines one or more prompt-capable CLI targets such as `agy`, `cmd`, `kilo`, or `kiro`.

The plugin stays tool-only:

- no provider replacement
- no fake model/provider
- no category hijack
- no shell rewrite hooks
- no streaming or background orchestration

## Installation

Clone from GitHub and build locally:

```bash
git clone https://github.com/minhquanle312/prompt-inject-opencode.git
cd prompt-inject-opencode
npm install
npm run build
```

This repository exports the plugin entry from `dist/index.js`, so the build step is required before loading the plugin from a GitHub checkout.

Create a JSON config file, for example `prompt-inject.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/minhquanle312/prompt-inject-opencode/main/prompt-inject.schema.json",
  "version": 1,
  "targets": {
    "agy": {
      "command": "agy",
      "args_before_prompt": ["-p"],
      "args_after_prompt": []
    },
    "cmd": {
      "command": "cmd",
      "args_before_prompt": ["--prompt"],
      "args_after_prompt": []
    },
    "kilo": {
      "command": "kilo",
      "args_before_prompt": ["prompt"],
      "args_after_prompt": []
    }
  }
}
```

Register the plugin in OpenCode using tuple options:

```jsonc
{
  "plugin": [
    ["/absolute/path/to/prompt-inject-opencode", { "config_path": "./prompt-inject.json" }]
  ]
}
```

The `config_path` option is required. Relative paths resolve from the plugin input directory.

For a local checkout, keep `prompt-inject.json` inside the plugin repository or pass an absolute `config_path`.

## Usage

Registered tool name: `prompt_inject`

At runtime, choose one configured target and provide a prompt. The plugin resolves the configured executable from `PATH` or accepts an absolute executable path from the JSON config.

Safety behavior:

- uses `spawn()` with argument arrays only
- uses `shell: false`
- inserts prompt as one argv item
- checks executable existence on `PATH`
- times out safely with `SIGTERM`, then `SIGKILL` fallback
- treats exit code `0` plus empty stdout as failure
- redacts prompt contents from returned `command`
- constrains `working_directory` to the OpenCode tool context directory

## Tool schema

Input:

```json
{
  "target": "agy",
  "prompt": "Summarize this repository in 5 bullets.",
  "timeout_ms": 30000,
  "working_directory": "packages/core"
}
```

Fields:

- `target: string` - required, must match a key in the JSON config `targets`
- `prompt: string` - required, trimmed, must be non-empty
- `timeout_ms?: number` - optional, integer, `1..300000`, default `30000`
- `working_directory?: string` - optional, must stay inside the OpenCode tool context directory

Output shape:

```json
{
  "target": "agy",
  "ok": true,
  "content": "model response",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 143,
  "empty_stdout": false,
  "timed_out": false,
  "command": "agy -p \"[REDACTED]\""
}
```

Handled failure cases include:

- target executable missing from `PATH`
- timeout reached
- non-zero exit code
- exit code `0` with empty stdout
- spawn/runtime stderr preserved for debugging

Public JSON Schema is published at:

```text
https://raw.githubusercontent.com/minhquanle312/prompt-inject-opencode/main/prompt-inject.schema.json
```

## Examples

Use Antigravity CLI target:

```json
{
  "target": "agy",
  "prompt": "Summarize latest failing deployment log and list likely root causes."
}
```

Use another configured CLI target:

```json
{
  "target": "cmd",
  "prompt": "Explain this package architecture in 5 bullets."
}
```

Run from a repo subdirectory:

```json
{
  "target": "kilo",
  "prompt": "Generate a migration checklist for this package.",
  "working_directory": "packages/core"
}
```

Bound long-running execution:

```json
{
  "target": "agy",
  "prompt": "Review these compiler errors and suggest the smallest safe fix.",
  "timeout_ms": 10000
}
```

## Limitations

- MVP only
- synchronous only
- single-shot only
- no streaming
- no background orchestration
- no shared or proxy execution
- command config uses argv fragments only, not shell command strings
- current executable lookup is POSIX-oriented

## Development

Project layout:

- `src/config.ts` - plugin option parsing and JSON config validation
- `src/run-configured-cli.ts` - generic safe CLI execution runner
- `src/prompt-inject-tool.ts` - tool schema and target dispatch
- `src/index.ts` - OpenCode plugin registration
- `prompt-inject.schema.json` - public config schema
- `ARCHITECTURE.md` - small design note

Local setup:

```bash
npm install
npm run build
npm run typecheck
```

## Testing

Run tests:

```bash
npm test
```

Current test coverage includes:

- plugin option parsing
- config file loading and validation
- single tool registration
- multi-target dispatch
- prompt validation
- executable missing from `PATH`
- timeout handling
- non-zero exit code
- empty stdout with exit code `0`
- stderr preservation
- working directory containment

## Test with OpenCode

Unit tests verify the plugin internals:

```bash
npm test
```

To smoke-test the plugin inside OpenCode:

1. Clone and build this repository:

   ```bash
   git clone https://github.com/minhquanle312/prompt-inject-opencode.git
   cd prompt-inject-opencode
   npm install
   npm run build
   ```

2. Create `prompt-inject.json` in the plugin repository with at least one real target that exists on your `PATH`:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/minhquanle312/prompt-inject-opencode/main/prompt-inject.schema.json",
     "version": 1,
     "targets": {
       "agy": {
         "command": "agy",
         "args_before_prompt": ["-p"],
         "args_after_prompt": []
       }
     }
   }
   ```

3. Register the built plugin in your OpenCode config:

   ```jsonc
   {
     "plugin": [
       ["/absolute/path/to/prompt-inject-opencode", { "config_path": "./prompt-inject.json" }]
     ]
   }
   ```

4. Start OpenCode and confirm the plugin loads without startup errors.

5. Run a smoke test by invoking `prompt_inject` with a configured target and a simple prompt.

Expected success signals:

- OpenCode starts without plugin config errors
- the `prompt_inject` tool is available
- calling the tool returns structured JSON output
- `ok: true` and non-empty `content` when the target CLI succeeds

Common failure signals:

- `config_path does not exist or is not readable`
- `unknown target: ...`
- `<command> binary not found on PATH`
- `timed_out: true`
- `empty_stdout: true` when the CLI exits `0` without stdout
