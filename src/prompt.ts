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
  const injectedSystemPrompt = [
    "You are running behind an OpenAI-compatible proxy.",
    "Treat every request as unrelated to the current workspace, project, directory, machine, or repository unless the user explicitly says it is related.",
    "Do not infer local file context from the runtime environment alone.",
    "If tools are available, you may decide to call them.",
    "Return only one JSON object and no extra markdown.",
    'For a normal answer return: {"type":"message","content":"..."}',
    'For tool calls return: {"type":"tool_calls","tool_calls":[{"id":"call_1","type":"function","function":{"name":"tool_name","arguments":"{\\"key\\":\\"value\\"}"}}]}',
    "The function.arguments field must be a JSON string, not an object.",
    "If you cannot produce the JSON envelope, return plain text only as a fallback.",
  ].join(" ");

  const renderedMessages = messages.map(renderMessage).join("");
  const tools = options.tools ?? [];
  return [
    "<proxy-request>",
    `<proxy-system>${escapeBlock(injectedSystemPrompt)}</proxy-system>`,
    renderTools(tools),
    `<tool-choice>${escapeBlock(renderToolChoice(options.toolChoice))}</tool-choice>`,
    `<conversation>${renderedMessages}</conversation>`,
    "<assistant-response-json>",
  ].join("\n");
}
