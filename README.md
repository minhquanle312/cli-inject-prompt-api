# Local OpenAI-Compatible CLI Proxy

Local-only OpenAI-compatible proxy for fallback sub-agents. It accepts chat-completion requests, runs a configured CLI command, captures stdout, and returns that text in an OpenAI-style response.

## Supported Endpoints

- `GET /v1/models`
- `POST /v1/chat/completions`

Streaming is not supported in v1. Requests with `"stream": true` return `400`.

## Models

| API model | Command |
| --- | --- |
| `gemini-3.5-flash` | `agy -p <prompt>` |
| `kimi-k2.5` | `cmd -p --model moonshotai/Kimi-K2.5` |
| `kimi-k2.6` | `cmd -p --model moonshotai/Kimi-K2.6` |
| `minimax-m2.7` | `cmd -p --model MiniMaxAI/MiniMax-M2.7` |
| `glm-5.1` | `cmd -p --model zai-org/GLM-5.1` |

Prompt text is sent as a command argument for `agy` and through stdin for `cmd`. Commands run with `shell: false`.

## Run

```bash
npm install
npm run build
npm start
```

Defaults:

- `HOST=127.0.0.1`
- `PORT=3000`
- `GLOBAL_CONCURRENCY=4`
- `MAX_QUEUE=20`
- `TIMEOUT_MS=300000`

## Examples

```bash
curl http://127.0.0.1:3000/v1/models
```

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

## Request Subset

Supported message roles: `system`, `developer`, `user`, `assistant`.

Only string `message.content` is supported. Tool calls, multimodal content arrays, JSON mode, and streaming are not implemented in v1.

## Concurrency

The proxy runs up to 4 commands globally and 1 command per model. Extra requests wait in a FIFO queue capped at 20 waiting jobs. If the queue is full, the response is `429`.

## Troubleshooting

- Missing `agy` or `cmd` binary returns `502 backend_spawn_error`.
- Non-zero command exit returns `502 backend_error` with stderr/stdout detail.
- Command timeout returns `504 backend_timeout`.
