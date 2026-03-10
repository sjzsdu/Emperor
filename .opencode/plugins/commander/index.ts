import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonTaskStore } from "./store"
import { createTaskTool } from "./tools/task"
import { createStatusTool } from "./tools/status"
import { createHaltTool } from "./tools/halt"

export const CommanderPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonTaskStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "commander", level: "info", message: "🎖️ Commander plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      const configAny = openCodeConfig as any
      if (!configAny.agent) {
        configAny.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        configAny.agent[id] = agentConfig
      }
    },
    tool: {
      cmd_task: createTaskTool(client, store, config),
      cmd_status: createStatusTool(store),
      cmd_halt: createHaltTool(client, store),
    },
  }
}
