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
