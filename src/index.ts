import type { Plugin } from "@opencode-ai/plugin"
import { loadPromptInjectConfig } from "./config.js"
import { createPromptInjectTool } from "./prompt-inject-tool.js"

export const server: Plugin = async (input, options) => {
  const { config } = await loadPromptInjectConfig(input.directory, options)

  return {
    tool: {
      prompt_inject: createPromptInjectTool(config),
    },
  }
}

export default server
