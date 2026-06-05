import type { ChatMessage, ProxyTool, ToolChoice } from "./types.js";

function escapeBlock(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderToolChoice(toolChoice: ToolChoice | undefined): string {
  if (toolChoice === undefined) return "auto";
  if (typeof toolChoice === "string") return toolChoice;
  return JSON.stringify(toolChoice);
}

function renderTools(tools: readonly ProxyTool[]): string {
  if (tools.length === 0) return "<tools>[]</tools>";
  return `<tools>${escapeBlock(JSON.stringify(tools))}</tools>`;
}

function renderToolNames(tools: readonly ProxyTool[]): string {
  if (tools.length === 0) return "none";
  return tools.map((tool) => tool.function.name).join(", ");
}

function renderMessage(message: ChatMessage): string {
  const attrs = [`role="${message.role}"`];
  if (message.name) attrs.push(`name="${escapeBlock(message.name)}"`);
  if (message.tool_call_id) attrs.push(`tool_call_id="${escapeBlock(message.tool_call_id)}"`);
  const contentTag = message.role === "user" ? "user-prompt" : "content";
  const parts = [`<message ${attrs.join(" ")}>`];
  if (message.content !== undefined) parts.push(`<${contentTag}>${escapeBlock(message.content)}</${contentTag}>`);
  if (message.tool_calls?.length) parts.push(`<tool-calls>${escapeBlock(JSON.stringify(message.tool_calls))}</tool-calls>`);
  parts.push("</message>");
  return parts.join("");
}

export function buildPrompt(
  messages: readonly ChatMessage[],
  options: { tools?: readonly ProxyTool[]; toolChoice?: ToolChoice } = {},
): string {
  const tools = options.tools ?? [];
  const toolNames = renderToolNames(tools);
  const injectedSystemPrompt = [
    "You are running behind an OpenAI-compatible proxy.",
    "Treat every request as unrelated to the current workspace, project, directory, machine, repository, Docker container, or proxy runtime unless the user explicitly says it is related.",
    "All filesystem references should be treated as remote-user context, never proxy-host or container-local context.",
    "Do not infer file or directory context from the runtime environment alone.",
    "Never use the proxy host or container current working directory, Docker workdir, mount path, runtime-local path, or repository path as the user's target path.",
    "Paths such as /app, /workspace, /root, the current process cwd, and the proxy repository location are always irrelevant unless the caller explicitly provides them.",
    "If the user refers to this directory, current folder, here, or similar relative context without an explicit path, do not substitute any local runtime path and do not anchor the request to the proxy/container environment.",
    "If tools are available, you may decide to call them.",
    `The only callable function names for this request are: ${toolNames}.`,
    "Never invent a tool name, alias, synonym, or placeholder.",
    "If no listed tool fits, return a normal message instead of a tool call.",
    "Return only one JSON object and no extra markdown.",
    'For a normal answer return: {"type":"message","content":"..."}',
    'For tool calls return: {"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"EXACT_TOOL_NAME_FROM_LIST","arguments":"{\\"key\\":\\"value\\"}"}}]}',
    "The function.arguments field must be a JSON string, not an object.",
    "If you cannot produce the JSON envelope, return plain text only as a fallback.",
  ].join(" ");

  const renderedMessages = messages.map(renderMessage).join("");
  return [
    "<proxy-request>",
    `<proxy-system>${escapeBlock(injectedSystemPrompt)}</proxy-system>`,
    renderTools(tools),
    `<tool-choice>${escapeBlock(renderToolChoice(options.toolChoice))}</tool-choice>`,
    `<conversation>${renderedMessages}</conversation>`,
    "<assistant-response-json>",
  ].join("\n");
}
