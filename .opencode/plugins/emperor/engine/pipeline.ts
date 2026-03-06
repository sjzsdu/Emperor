import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { ToolContext } from "@opencode-ai/plugin"
import type { Edict, EdictStore, EmperorConfig, Execution, Plan } from "../types"
import { reviewWithMenxia } from "./reviewer"
import { dispatchAndExecute } from "./dispatcher"

const DEPT_DISPLAY: Record<string, string> = {
  bingbu: "兵部",
  gongbu: "工部",
  libu: "礼部",
  xingbu: "刑部",
  hubu: "户部",
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {}
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {}
  }
  return null
}

function parsePlan(text: string, attempt: number): Plan {
  const data = parseJSON(text)
  if (!data || typeof data !== "object") {
    throw new Error("中书省输出格式错误：无法解析 JSON")
  }
  const obj = data as Record<string, unknown>
  if (!obj.analysis || !Array.isArray(obj.subtasks)) {
    throw new Error("中书省输出格式错误：缺少 analysis 或 subtasks 字段")
  }
  return {
    analysis: String(obj.analysis),
    subtasks: obj.subtasks as Plan["subtasks"],
    risks: Array.isArray(obj.risks) ? (obj.risks as string[]) : [],
    attempt: typeof obj.attempt === "number" ? obj.attempt : attempt,
  }
}

export async function planWithZhongshu(
  client: OpencodeClient,
  edict: Edict,
  attempt: number,
  rejectionReasons?: string[],
): Promise<Plan> {
  const session = await client.session.create({
    body: { title: `中书省·${edict.title}` },
  })
  const sessionId = session.data!.id

  let prompt: string
  if (attempt === 1) {
    prompt = `请规划以下旨意，拆解为可执行的子任务。

标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

请输出严格的 Plan JSON。`
  } else {
    prompt = `上次规划方案被门下省封驳，原因如下：
${rejectionReasons?.map((r) => `- ${r}`).join("\n") ?? "（无具体原因）"}

请重新规划以下旨意（第 ${attempt} 次尝试）：

标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

请输出严格的 Plan JSON，注意改进被指出的问题。`
  }

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "zhongshu",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  const text = extractText(response.data?.parts ?? [])
  return parsePlan(text, attempt)
}

function checkAbort(abort: AbortSignal): void {
  if (abort.aborted) {
    throw new Error("用户已叫停")
  }
}

export async function runPipeline(
  edict: Edict,
  context: ToolContext,
  client: OpencodeClient,
  store: EdictStore,
  config: EmperorConfig,
): Promise<string> {
  let plan: Plan | undefined
  let rejectionReasons: string[] | undefined

  // Phase 1: 中书省 Planning + 门下省 Review loop
  const maxAttempts = config.pipeline.maxReviewAttempts
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    checkAbort(context.abort)

    store.update(edict.id, { status: "planning" })
    client.tui.showToast({ body: { message: `📜 中书省规划中...（第 ${attempt} 次）`, variant: "info" } })

    try {
      plan = await planWithZhongshu(client, edict, attempt, rejectionReasons)
    } catch (err) {
      if (attempt === maxAttempts) {
        store.update(edict.id, { status: "failed" })
        throw new Error(`中书省规划失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      continue
    }

    store.update(edict.id, { plan, status: "reviewing" })
    checkAbort(context.abort)

    client.tui.showToast({ body: { message: "🔍 门下省审核中...", variant: "info" } })
    const review = await reviewWithMenxia(client, edict, plan, config.pipeline.sensitivePatterns)
    store.update(edict.id, { review })

    if (review.verdict === "approve") {
      if (review.sensitiveOps.length > 0) {
        store.update(edict.id, { status: "needs_approval" })
        client.tui.showToast({ body: { message: "⚠️ 检测到敏感操作，需要您确认", variant: "warning" } })
        try {
          await context.ask({
            permission: "edict.sensitive",
            patterns: review.sensitiveOps,
            always: [],
            metadata: {
              edictId: edict.id,
              sensitiveOps: review.sensitiveOps,
            },
          })
        } catch {
          store.update(edict.id, { status: "denied" })
          throw new Error("用户拒绝执行含敏感操作的旨意")
        }
      }
      client.tui.showToast({ body: { message: "✅ 门下省准奏", variant: "success" } })
      break
    }

    // Rejected
    client.tui.showToast({ body: { message: `🚫 门下省封驳（第 ${attempt} 次）`, variant: "warning" } })
    rejectionReasons = review.reasons
    store.update(edict.id, { status: "rejected" })

    if (attempt === maxAttempts) {
      store.update(edict.id, { status: "failed" })
      throw new Error(`规划方案连续 ${maxAttempts} 次被门下省封驳`)
    }
  }

  if (!plan) {
    store.update(edict.id, { status: "failed" })
    throw new Error("规划阶段未生成有效方案")
  }

  // Phase 2: 尚书省 Dispatch + 六部 Execution
  checkAbort(context.abort)
  store.update(edict.id, { status: "dispatched" })
  client.tui.showToast({ body: { message: "⚔️ 六部执行中...", variant: "info" } })

  store.update(edict.id, { status: "executing" })
  const executions = await dispatchAndExecute(client, edict, plan)
  store.update(edict.id, { executions })

  // Phase 3: Memorial
  const memorial = formatMemorial(edict, plan, executions)
  store.update(edict.id, { memorial, status: "completed" })
  client.tui.showToast({ body: { message: "📋 奏折已归档", variant: "success" } })

  return memorial
}

export function formatMemorial(edict: Edict, plan: Plan, executions: Execution[]): string {
  const lines: string[] = []

  lines.push(`# 奏折：${edict.title}`)
  lines.push("")
  lines.push("## 旨意")
  lines.push(edict.content)
  lines.push("")

  lines.push("## 规划方案（中书省）")
  lines.push(`**分析：** ${plan.analysis}`)
  lines.push("")
  lines.push("### 子任务")
  lines.push("| # | 部门 | 任务 | 状态 |")
  lines.push("|---|------|------|------|")
  for (const st of plan.subtasks) {
    const exec = executions.find((e) => e.subtaskIndex === st.index)
    const statusIcon = exec?.status === "completed" ? "✅ 完成" : exec?.status === "failed" ? "❌ 失败" : "⏳ 未执行"
    const dept = DEPT_DISPLAY[st.department] ?? st.department
    lines.push(`| ${st.index} | ${dept} | ${st.title} | ${statusIcon} |`)
  }
  lines.push("")

  if (plan.risks.length > 0) {
    lines.push("### 风险评估")
    for (const risk of plan.risks) {
      lines.push(`- ${risk}`)
    }
    lines.push("")
  }

  lines.push("## 执行结果")
  for (const exec of executions) {
    const subtask = plan.subtasks.find((s) => s.index === exec.subtaskIndex)
    const dept = DEPT_DISPLAY[exec.department] ?? exec.department
    const title = subtask?.title ?? `子任务 ${exec.subtaskIndex}`
    lines.push(`### ${dept}: ${title}`)
    if (exec.status === "completed" && exec.result) {
      lines.push(exec.result)
    } else if (exec.status === "failed") {
      lines.push(`❌ 执行失败: ${exec.error ?? "未知错误"}`)
    }
    lines.push("")
  }

  const completed = executions.filter((e) => e.status === "completed").length
  const total = executions.length
  lines.push("## 总结")
  lines.push(`成功: ${completed}/${total} 个子任务完成`)
  if (completed < total) {
    const failed = executions.filter((e) => e.status === "failed")
    for (const f of failed) {
      const dept = DEPT_DISPLAY[f.department] ?? f.department
      lines.push(`- ${dept} 执行失败: ${f.error ?? "未知错误"}`)
    }
  }

  return lines.join("\n")
}
