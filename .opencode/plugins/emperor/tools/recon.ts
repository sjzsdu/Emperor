import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { EdictStore } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

async function invokeJinyiwei(
  client: OpencodeClient,
  prompt: string,
  sessionTitle: string,
): Promise<string> {
  const session = await client.session.create({
    body: { title: sessionTitle },
  })
  const sessionId = session.data!.id

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "jinyiwei",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  return extractText(response.data?.parts ?? [])
}

// ============================================================
// Tool 1: 太子侦察 — taizi_recon
// ============================================================

export function createTaiziReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "太子侦察：命令锦衣卫扫描项目，获取项目高层概览和需要向皇帝（用户）澄清的事项。用于接收需求后的初步了解和需求梳理。",
    args: {
      edict_id: tool.schema.string().optional().describe("旨意 ID（如已创建）"),
      title: tool.schema.string().optional().describe("需求标题（无旨意时使用）"),
      content: tool.schema.string().optional().describe("需求内容（无旨意时使用）"),
    },
    async execute(args) {
      let title = args.title ?? ""
      let content = args.content ?? ""

      if (args.edict_id) {
        const edict = store.get(args.edict_id)
        if (edict) {
          title = title || edict.title
          content = content || edict.content
        }
      }

      if (!title && !content) {
        return "请提供 edict_id 或 title/content 参数。"
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为太子侦察中...", variant: "info" } })

      const prompt = `请以太子的视角对项目进行高层侦察。

## 当前需求
标题: ${title}
内容: ${content}

## 侦察要求（太子视角）

太子需要全局信息，用于判断需求是否明确、是否需要跟皇帝（用户）澄清。请重点关注：

1. **项目概览**：技术栈、主要模块、项目规模（简要即可）
2. **与需求的关联**：哪些现有模块与本次需求直接相关
3. **需求澄清建议** ⭐ 重点：
   - 基于对项目的了解，列出需求中可能不明朗或有歧义的事项
   - 标注每个事项的优先级（必须澄清 / 建议澄清 / 可后续确认）
   - 如果需求已经足够清晰，明确说明"无需额外澄清"
4. **风险预判**：可能的技术风险或实现难点概述

请用结构化格式输出，重点突出「需要澄清的事项」部分。
控制篇幅，太子需要的是决策信息而非技术细节。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·太子侦察·${title}`)

      client.tui.showToast({ body: { message: "🕵️ 太子侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 2: 中书省侦察 — zhongshu_recon
// ============================================================

export function createZhongshuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "中书省侦察：命令锦衣卫深度扫描项目，获取详细技术上下文用于制定规划方案。包含目录结构、架构模式、模块依赖、代码规范、功能地图等完整信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      focus_areas: tool.schema.string().optional().describe("需要重点侦察的领域或模块（可选）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为中书省深度侦察中...", variant: "info" } })

      const focusBlock = args.focus_areas
        ? `\n## 重点侦察领域\n${args.focus_areas}\n`
        : ""

      const prompt = `请以中书省的视角对项目进行深度侦察，为制定规划方案提供全面的技术上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}
${focusBlock}
## 侦察要求（中书省视角）

中书省需要完整的技术细节来拆解任务和分配部门。请全面覆盖：

1. **技术栈详情**：语言、框架、构建工具、包管理器、主要依赖库及版本
2. **目录结构分析**：模块划分、入口文件、配置位置、测试目录
3. **架构模式识别**：设计模式、分层架构、数据流
4. **模块依赖图**：用 mermaid 展示核心模块间的依赖关系
5. **代码规范与模式**：命名规范、错误处理模式、日志方式、测试框架与模式
6. **与旨意相关的功能地图** ⭐ 重点：
   - 与本次需求直接相关的模块详细分析
   - 现有实现、接口定义、数据结构
   - 可复用的组件和模式
7. **技术约束与限制**：已知的技术限制、兼容性要求

请生成包含 mermaid 图表的结构化报告，内容尽可能详尽，为规划方案提供充分依据。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·中书省侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 中书省侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 3: 门下省侦察 — menxia_recon
// ============================================================

export function createMenxiaReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "门下省侦察：命令锦衣卫扫描项目，获取审核所需的关键信息摘要。聚焦于架构约束、风险区域、现有规范等审核关注点。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为门下省侦察中...", variant: "info" } })

      const planBlock = edict.plan
        ? `\n## 待审核的规划方案\n${JSON.stringify(edict.plan, null, 2)}\n`
        : ""

      const prompt = `请以门下省的视角对项目进行侦察，为审核规划方案提供关键上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}
${planBlock}
## 侦察要求（门下省视角）

门下省需要审核关注点的精简信息，而非全部细节。请重点关注：

1. **架构约束**：项目的核心架构规则，方案不应违背的原则
2. **现有规范**：已建立的模式和编码规范，方案应保持一致
3. **风险区域**：项目中已知的脆弱点、复杂模块、性能敏感区域
4. **关键依赖**：核心模块间的依赖关系，影响子任务执行顺序的因素
5. **测试覆盖现状**：现有测试的覆盖情况和测试规范

请用精简摘要格式输出，突出审核关注点，避免冗余细节。
控制篇幅在完整侦察报告的 1/3 以内。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·门下省侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 门下省侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 4: 吏部侦察 — libu_recon
// ============================================================

export function createLibuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "吏部侦察：命令锦衣卫扫描项目，获取架构设计和文档更新所需的项目上下文。聚焦于模块结构、架构模式、类型系统、依赖关系等架构层面信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为吏部侦察中...", variant: "info" } })

      const prompt = `请以吏部（架构师）的视角对项目进行侦察，为架构设计和文档更新提供上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求（吏部视角）

吏部需要架构层面的信息来设计或更新系统架构。请重点关注：

1. **模块结构**：各模块的职责边界、接口定义、依赖关系
2. **架构模式**：当前使用的设计模式、分层架构、数据流
3. **类型系统**：核心类型定义、接口约束、泛型使用
4. **现有文档**：当前文档的分布、格式和覆盖范围
5. **与旨意相关的模块**：需要架构调整或文档更新的具体区域

请用结构化格式输出，重点突出架构层面的信息。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·吏部侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 吏部侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 5: 兵部侦察 — bingbu_recon
// ============================================================

export function createBingbuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "兵部侦察：命令锦衣卫扫描项目，获取编码实现所需的项目上下文。聚焦于代码风格、现有实现、接口定义、测试模式等实现层面信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为兵部侦察中...", variant: "info" } })

      const prompt = `请以兵部（编码实现）的视角对项目进行侦察，为编码实现提供上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求（兵部视角）

兵部需要实现层面的信息来编写代码。请重点关注：

1. **代码风格**：命名规范、缩进、导入顺序、注释风格
2. **现有实现**：与旨意相关的现有代码、函数、类
3. **接口定义**：相关的 API、类型定义、数据结构
4. **测试模式**：现有测试的编写方式、框架、模式
5. **错误处理**：项目的错误处理模式、自定义错误类
6. **可复用组件**：可以直接复用的现有工具函数、组件

请用结构化格式输出，重点突出实现层面的实用信息。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·兵部侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 兵部侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 6: 户部侦察 — hubu_recon
// ============================================================

export function createHubuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "户部侦察：命令锦衣卫扫描项目，获取测试验证所需的项目上下文。聚焦于测试框架、测试命令、构建配置、现有测试覆盖等测试层面信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为户部侦察中...", variant: "info" } })

      const prompt = `请以户部（测试官）的视角对项目进行侦察，为测试验证提供上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求（户部视角）

户部需要测试相关的信息来编写和执行测试。请重点关注：

1. **测试框架**：使用的测试框架（Jest/Vitest/Mocha 等）、配置文件位置
2. **测试命令**：如何运行测试（npm test / bun test 等）、如何运行构建
3. **现有测试**：测试目录结构、测试命名规范、mock 模式
4. **构建配置**：构建工具、构建命令、构建输出
5. **CI 集成**： CI 中的测试步骤和要求

请用结构化格式输出，重点突出测试执行所需的实用信息。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·户部侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 户部侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 7: 刑部侦察 — xingbu_recon
// ============================================================

export function createXingbuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "刑部侦察：命令锦衣卫扫描项目，获取安全审计所需的项目上下文。聚焦于安全配置、敏感数据处理、依赖安全性、权限控制等安全层面信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为刑部侦察中...", variant: "info" } })

      const prompt = `请以刑部（安全审计官）的视角对项目进行侦察，为安全合规审查提供上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求（刑部视角）

刑部需要安全层面的信息来进行安全审计。请重点关注：

1. **安全配置**：认证、授权、加密配置、CORS 策略
2. **敏感数据处理**：密码、密钥、个人信息的处理方式
3. **依赖安全性**：依赖包版本、已知漏洞
4. **权限控制**：访问控制模式、权限检查机制
5. **输入验证**：用户输入的验证和消毒模式
6. **日志审计**：日志记录、审计跟踪机制

请用结构化格式输出，重点突出安全审计关注点。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·刑部侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 刑部侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}

// ============================================================
// Tool 8: 工部侦察 — gongbu_recon
// ============================================================

export function createGongbuReconTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "工部侦察：命令锦衣卫扫描项目，获取CI/CD和基础设施更新所需的项目上下文。聚焦于构建配置、CI/CD流水线、部署配置、环境变量等基建层面信息。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      client.tui.showToast({ body: { message: "🕵️ 锦衣卫为工部侦察中...", variant: "info" } })

      const prompt = `请以工部（基础设施工程师）的视角对项目进行侦察，为CI/CD和基建更新提供上下文。

## 当前旨意
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求（工部视角）

工部需要基建层面的信息来评估和更新CI/CD配置。请重点关注：

1. **构建配置**：构建工具（Webpack/Vite/esbuild/tsc）、构建脚本、构建输出
2. **CI/CD 流水线**：GitHub Actions/GitLab CI 配置、步骤、触发条件
3. **部署配置**：Docker/Kubernetes 配置、部署脚本、环境变量
4. **包管理**：包管理器、依赖版本策略、lock 文件
5. **环境配置**：开发/测试/生产环境配置差异

请用结构化格式输出，重点突出基建层面的实用信息。`

      const result = await invokeJinyiwei(client, prompt, `锦衣卫·工部侦察·${edict.title}`)

      client.tui.showToast({ body: { message: "🕵️ 工部侦察完毕", variant: "success" } })
      return result || "锦衣卫侦察未返回结果。"
    },
  })
}
