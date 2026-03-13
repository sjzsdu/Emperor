import type { Plugin } from "sjz-opencode-sdk"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { discoverDomains } from "./discovery/index"
import { generateAgents } from "./agents/index"
import { createEmitTool } from "./tools/emit"
import { createStatusTool } from "./tools/status"
import { createBroadcastTool } from "./tools/broadcast"
import { createNegotiateTool } from "./tools/negotiate"
import { createDispatchTool } from "./tools/dispatch"
import { createConfigHook } from "./hooks/config"
import { createSystemTransformHook } from "./hooks/system-transform"
import { createFileWatcherHook } from "./hooks/file-watcher"
import { createAutonomyHandler } from "./hooks/autonomy"
import { HiveStore } from "./store"

export const HivePlugin: Plugin = async ({ client, directory, registerAgent, registerCommand }) => {
  const config = loadConfig(directory)
  const store = new HiveStore(directory, config.store.dataDir)

  // EventBus with persistence
  const eventBus = new HiveEventBus(
    (events) => store.saveEvents(events),
    () => store.loadEvents(),
  )
  eventBus.restore()

  // Session → Domain mapping
  const sessionToDomain = new Map<string, string>()

  // Discover domains (static scan is synchronous, LLM enrichment runs in background)
  // After LLM enrichment, registerAgent will be called to dynamically add agents
  const domains = discoverDomains(directory, config, client, registerAgent)

  // Subscribe domains to EventBus
  for (const domain of domains) {
    eventBus.autoSubscribe(domain)
  }

  // Generate agent configs
  const agents = generateAgents(domains, config)

  // Set up autonomy handler
  const autonomyHandler = createAutonomyHandler(
    eventBus, domains, config, client, sessionToDomain,
  )

  // Register slash command
  try {
    await registerCommand({
      name: "hive-init",
      description: "初始化 Hive：创建配置文件和存储目录，自动发现项目中的 Domain",
      subtask: true,
      template: `
请执行 Hive 初始化任务。

## 用户参数
$ARGUMENTS (如 --force 表示强制覆盖)

## 任务说明
1. 检查 .opencode/hive.json 是否已存在
   - 如果存在且用户没有 --force 参数 → 跳过，报告已存在
   - 如果存在且用户有 --force 参数 → 覆盖
   - 如果不存在 → 创建

2. 创建配置文件 .opencode/hive.json，内容如下：
{
  "discovery": { "autoRefresh": true },
  "coordination": { "autonomyLevel": "full" },
  "queen": {},
  "store": { "dataDir": ".hive" }
}

3. 创建存储目录 .hive

4. 使用 bash 和 write_file 工具完成上述任务
5. 完成后报告初始化结果
      `.trim(),
    })
  } catch (error) {
    console.error("[hive] Failed to register hive-init command:", error)
  }

  return {
    config: createConfigHook(agents),

    "experimental.chat.system.transform": createSystemTransformHook(
      eventBus, sessionToDomain,
    ),

    "tool.execute.after": createFileWatcherHook(
      eventBus, domains, sessionToDomain, autonomyHandler,
    ),

    tool: {
      hive_emit: createEmitTool(eventBus, sessionToDomain),
      hive_status: createStatusTool(domains, eventBus),
      hive_broadcast: createBroadcastTool(eventBus, domains, client, sessionToDomain, config),
      hive_negotiate: createNegotiateTool(eventBus, domains, client, sessionToDomain),
      hive_dispatch: createDispatchTool(eventBus, domains, client, sessionToDomain),
    },
  }
}
