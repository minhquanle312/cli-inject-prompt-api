# Local OpenAI-Compatible CLI Proxy

Local-only OpenAI-compatible proxy for fallback sub-agents. It accepts chat-completion requests, runs a configured CLI command, captures stdout, and returns that text in an OpenAI-style response.

## Supported Endpoints

- `GET /v1/models`
- `GET /v1/models/metadata`
- `GET /v1/models/catalog`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Streaming is supported as a buffered fake-stream in v1. Streaming is enabled by default when `stream` is omitted, the proxy also honors `Accept: text/event-stream`, and requests only fall back to non-stream JSON when `"stream": false` is sent explicitly.

## Models

| API model          | Command                                 |
| ------------------ | --------------------------------------- |
| `gemini-3.5-flash` | `agy -p <prompt>`                       |
| `kimi-k2.5`        | `cmd -p --model moonshotai/Kimi-K2.5`   |
| `kimi-k2.6`        | `cmd -p --model moonshotai/Kimi-K2.6`   |
| `minimax-m2.7`     | `cmd -p --model MiniMaxAI/MiniMax-M2.7` |
| `glm-5.1`          | `cmd -p --model zai-org/GLM-5.1`        |

Prompt text is sent as a command argument for `agy` and through stdin for `cmd`. Commands run with `shell: false`.

## Run

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Defaults:

- `HOST=127.0.0.1`
- `PORT=3322`
- `API_KEY` is required and must be a non-placeholder value with at least 16 characters
- `GLOBAL_CONCURRENCY=4`
- `MAX_QUEUE=20`
- `TIMEOUT_MS=332200`

## Docker / Coolify

Set a strong `API_KEY` in `.env` or in Coolify environment variables, then deploy with the included `Dockerfile` or `docker-compose.yml`.

```bash
docker compose up --build
```

The Compose setup persists CLI auth/data across redeploys with named volumes mounted at `/root/.commandcode` and `/root/.gemini`. If deploying the `Dockerfile` directly in Coolify instead of the Compose file, configure persistent volumes for those same two target paths.

## Examples

```bash
curl http://127.0.0.1:3322/v1/models \
  -H "authorization: Bearer $API_KEY"
```

```bash
curl http://127.0.0.1:3322/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

To force the old non-stream JSON response shape:

```bash
curl http://127.0.0.1:3322/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "model": "gemini-3.5-flash",
    "stream": false,
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

## Request Subset

Supported message roles: `system`, `developer`, `user`, `assistant`, `tool`.

String `message.content` and text-ish content arrays are supported. The proxy also accepts OpenAI-style `tools`, `tool_choice`, assistant `tool_calls`, and tool messages.

The injected backend prompt is workspace-agnostic by default:

- It tells the CLI not to assume the request is related to the current workspace/project unless the user explicitly says so.
- It wraps real user text in `<user-prompt>...</user-prompt>`.
- It asks the CLI to return a strict JSON envelope for either assistant text or tool calls.

If the CLI still returns flat text, the proxy falls back to plain assistant content automatically.

## Tool Call Envelope

Best-effort backend contract:

```json
{"type":"message","content":"hello"}
```

```json
{"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"hello\"}"}}]}
```

The proxy converts that envelope into real OpenAI-compatible `tool_calls` for `/v1/chat/completions` and `function_call` output items for `/v1/responses`.

## Rich Model Metadata

`/v1/models` stays OpenAI-compatible and minimal.

For richer discovery metadata inspired by [models.dev](https://github.com/anomalyco/models.dev):

- `/v1/models/metadata` returns provider-agnostic model metadata
- `/v1/models/catalog` returns provider-grouped model metadata

## Concurrency

The proxy runs up to 4 commands globally and 1 command per model. Extra requests wait in a FIFO queue capped at 20 waiting jobs. If the queue is full, the response is `429`.

## Troubleshooting

- Missing `agy` or `cmd` binary returns `502 backend_spawn_error`.
- Non-zero command exit returns `502 backend_error` with stderr/stdout detail.
- Command timeout returns `504 backend_timeout`.
