import type { Plugin } from "sjz-opencode-sdk"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { discoverDomains, reloadDomains } from "./discovery/index"
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

  const domains = discoverDomains(directory, config, registerAgent)

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
      description: "初始化 Hive：创建配置文件、存储目录和自动发现项目中的 Domain",
      subtask: true,
      template: `
请执行 Hive 初始化任务。

## 用户参数
$ARGUMENTS (如 --force 表示强制覆盖)

## 任务说明

### 1. 检查现有文件
检查以下文件是否已存在:
- .opencode/hive.json
- .hive/domains.json

如果文件存在且用户没有 --force 参数 → 跳过并报告已存在
如果文件存在且用户有 --force 参数 → 覆盖
如果不存在 → 创建

### 2. 创建配置文件 .opencode/hive.json
内容如下:
{
  "discovery": { "autoRefresh": true },
  "coordination": { "autonomyLevel": "full" },
  "queen": {},
  "store": { "dataDir": ".hive" }
}

### 3. 创建存储目录 .hive

### 4. 发现并生成 domains.json
基于当前项目目录结构,自动发现 Domain 并生成 .hive/domains.json

#### 4.1 分析项目结构
使用 bash 工具列出项目根目录下的所有目录和文件:
- ls -la

分析以下内容:
1. package.json - 检测使用的技术栈 (dependencies, devDependencies),项目名称,版本
2. pnpm-workspace.yaml 或 workspaces 配置 - 检测 monorepo 结构
3. 根目录下的主要目录: src/, apps/, packages/, docs/, .github/
4. README.md - 读取项目描述,了解项目整体目标和功能
5. tsconfig.json - 了解 TypeScript 配置

#### 4.2 发现 Domain 规则
根据以下规则自动发现 Domain:

**Frontend 检测:**
- 目录: src/client, src/frontend, client, frontend, src/ui, src/components, src/pages, src/views
- 技术栈: React, Vue, Angular, Next.js, Nuxt (根据 package.json)
- paths: 匹配找到的目录

**Backend/API 检测:**
- 目录: src/server, src/backend, server, backend, src/api, src/routes
- 技术栈: Express, Fastify, Hono, NestJS, Koa (根据 package.json)
- paths: 匹配找到的目录

**Monorepo Apps 检测:**
- apps/ 目录下的每个子目录 → 独立 Domain
- packages/ 目录下的每个子目录 → 独立 Domain
- 每个 package 的 package.json 中的 name 和 description 作为 Domain 的 name 和 description

**Infra 检测:**
- 存在 .github/workflows, Dockerfile, docker-compose.yml → infra Domain
- 技术栈: Docker, GitHub Actions, Kubernetes
- paths: [".github/", "Dockerfile", "docker-compose.yml", "docker-compose.yaml"]

**Docs 检测:**
- 存在 docs/ 目录 → docs Domain
- 技术栈: Markdown, Docusaurus, VitePress
- paths: ["docs/", "*.md"]

**Shared/Common 检测:**
- 存在 src/shared, src/common, src/lib, src/utils, src/types → shared Domain

**Database 检测:**
- 存在 src/db, src/models, prisma/, migrations/, src/schema → database Domain
- 技术栈: PostgreSQL, MySQL, MongoDB, Prisma, Mongoose, Drizzle

**Config 检测:**
- 存在 .github/, .eslintrc, .prettierrc, tsconfig.json → config Domain

**Tests 检测:**
- 存在 tests/, __tests__, test/, *.test.ts, *.spec.ts → testing Domain
- 技术栈: Jest, Vitest, Mocha, Playwright, Cypress

#### 4.3 生成 domains.json 格式
生成 DomainCache 格式的 JSON 文件,结构如下:

- structureHash: 计算的项目结构 hash
- discoveredAt: 当前时间戳
- source: "static"
- domains: 数组,每个元素包含:
  - id: 唯一标识
  - name: 显示名称
  - description: 一句话描述
  - paths: 文件路径模式
  - techStack: 技术栈
  - responsibilities: 详细职责描述
  - interfaces: 暴露的接口
  - dependencies: 依赖的其他 domain
  - conventions: 代码约定

#### 4.4 宏观项目认知
每个 Domain 需要从项目整体角度认知:
1. **项目目标**: 从 README.md 提取项目是做什么的
2. **Domain 角色**: 这个 domain 在整个项目中扮演什么角色
3. **与其他 Domain 的关系**: 依赖哪些 domain,被哪些 domain 依赖
4. **维护要点**: 这个 domain 的代码需要关注什么(性能?安全?一致性?)

**示例 (假设这是一个全栈 React + Node.js 项目):**
- frontend: "负责用户界面渲染,与后端 API 交互,关注用户体验和交互流畅性"
- backend: "负责业务逻辑处理和数据持久化,提供 RESTful API,关注安全性和性能"
- database: "负责数据模型设计和迁移,保证数据完整性和一致性"

#### 4.5 读取 README 补充描述
必须读取以下文件来补充 Domain 信息:
1. 项目根目录 README.md - 提取项目整体描述和功能
2. docs/ 目录下的文档 - 了解架构设计和领域划分
3. 各个 domain 目录下的 README.md - 补充具体领域描述

### 5. 完成并报告
- 使用 bash 和 write 工具完成上述任务
- 完成后报告初始化结果,包括:
  - 创建/覆盖的文件 (.opencode/hive.json, .hive/domains.json)
  - 发现的 Domain 数量和名称
  - 每个 Domain 的 paths, techStack, responsibilities, dependencies
  - 项目的整体目标描述 (一句话)
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
      directory, config, registerAgent,
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
