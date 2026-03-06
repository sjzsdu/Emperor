import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonEdictStore } from "./store"
import { PROMPTS } from "./agents/prompts"
import { createEdictTool } from "./tools/edict"
import { createMemorialTool } from "./tools/memorial"
import { createHaltTool } from "./tools/halt"

export const EmperorPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonEdictStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "emperor", level: "info", message: "⚔️ Emperor plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      if (!openCodeConfig.agent) {
        openCodeConfig.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        // Inject the real prompt from prompts.ts if available
        const prompt = PROMPTS[id]
        if (prompt && (!agentConfig.prompt || agentConfig.prompt.startsWith("TODO"))) {
          agentConfig.prompt = prompt
        }
        openCodeConfig.agent[id] = agentConfig
      }
    },
    tool: {
      "下旨": createEdictTool(client, store, config),
      "查看奏折": createMemorialTool(store),
      "叫停": createHaltTool(client, store),
    },
  }
}
