import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonEdictStore } from "./store"
import { createEdictTool } from "./tools/edict"
import { createMemorialTool } from "./tools/memorial"
import { createHaltTool } from "./tools/halt"
import { createTaiziReconTool, createZhongshuReconTool, createMenxiaReconTool } from "./tools/recon"
import { createSubmitPlanTool, createRejectPlanTool, createApprovePlanTool } from "./tools/workflow"

export const EmperorPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonEdictStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "emperor", level: "info", message: "⚔️ Emperor plugin initialized" } })

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
      // === 原有工具 ===
      "edict": createEdictTool(client, store, config, directory),
      "memorial": createMemorialTool(store),
      "halt": createHaltTool(client, store),
      // === 锦衣卫侦察工具（各省视角） ===
      "taizi_recon": createTaiziReconTool(client, store),
      "zhongshu_recon": createZhongshuReconTool(client, store),
      "menxia_recon": createMenxiaReconTool(client, store),
      // === 三省流转工具 ===
      "submit_plan": createSubmitPlanTool(client, store),
      "reject_plan": createRejectPlanTool(client, store),
      "approve_plan": createApprovePlanTool(client, store, config),
    },
  }
}
