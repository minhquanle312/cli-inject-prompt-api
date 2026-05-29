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

Install package:

```bash
npm install prompt-inject-opencode
```

Create a JSON config file, for example `prompt-inject.json`:

```json
{
  "$schema": "https://unpkg.com/prompt-inject-opencode/prompt-inject.schema.json",
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
    ["prompt-inject-opencode", { "config_path": "./prompt-inject.json" }]
  ]
}
```

The `config_path` option is required. Relative paths resolve from the plugin input directory.

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
prompt-inject-opencode/prompt-inject.schema.json
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
