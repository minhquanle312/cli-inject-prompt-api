import type { ChatMessage } from "./types.js";

const labels = {
  system: "System",
  developer: "Developer",
  user: "User",
  assistant: "Assistant",
} as const;

export function buildPrompt(messages: readonly ChatMessage[]): string {
  const body = messages.map((message) => `${labels[message.role]}:\n${message.content}`).join("\n\n");
  return `${body}\n\nAssistant:`;
}
