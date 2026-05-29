# Architecture Note

Small split by responsibility.

## Files

- `src/config.ts` - parses plugin options and validates the required JSON config file
- `src/run-configured-cli.ts` - low-level process execution only
- `src/prompt-inject-tool.ts` - validates tool input, resolves working directory, selects target, maps runner result into OpenCode tool result
- `src/index.ts` - plugin entry, loads config once, registers exactly one tool: `prompt_inject`

## Why split this way

Config loading, process execution, and plugin wiring change for different reasons. Keeping them separate makes tests smaller and prevents OpenCode-specific concerns from leaking into process control.

## Safety choices

- uses direct `spawn()` with argument array
- `shell: false`
- config defines executable plus argv fragments only
- prompt inserted as one argv element
- explicit PATH lookup before execution
- returned `command` string redacts prompt contents
- optional `working_directory` constrained to tool context directory
- timeout enforced in-process
- graceful kill with `SIGTERM`, then `SIGKILL` fallback
- stderr preserved in structured result
- exit code `0` plus empty stdout treated as failure

## OpenCode integration

Plugin returns only the `tool` hook. No provider hooks. No shell rewrite hooks. No category interception. No model replacement.

The plugin requires tuple options with `config_path`, loads the target config once at startup, and exposes one generic tool that selects among configured targets at runtime.

The tool returns structured execution data as JSON text in `output`, with the same object attached in `metadata` for machine-friendly access.
