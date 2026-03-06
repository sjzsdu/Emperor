import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { Edict, Plan, Review } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function parseJSON(text: string): unknown {
  // Try direct parse
  try {
    return JSON.parse(text)
  } catch {}
  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }
  // Try finding first { to last }
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {}
  }
  return null
}

function parseReview(text: string): Review {
  const data = parseJSON(text)
  if (!data || typeof data !== "object") {
    throw new Error("门下省输出格式错误：无法解析 JSON")
  }
  const obj = data as Record<string, unknown>
  const verdict = obj.verdict
  if (verdict !== "approve" && verdict !== "reject") {
    throw new Error(`门下省输出格式错误：verdict 必须为 "approve" 或 "reject"，实际为 "${String(verdict)}"`)
  }
  return {
    verdict,
    reasons: Array.isArray(obj.reasons) ? (obj.reasons as string[]) : [],
    suggestions: Array.isArray(obj.suggestions) ? (obj.suggestions as string[]) : [],
    sensitiveOps: Array.isArray(obj.sensitiveOps) ? (obj.sensitiveOps as string[]) : [],
  }
}

/** Scan subtask descriptions for sensitive operation patterns */
export function detectSensitiveOps(plan: Plan, patterns: string[]): string[] {
  const detected: string[] = []
  for (const pattern of patterns) {
    let regex: RegExp
    try {
      regex = new RegExp(pattern, "i")
    } catch {
      continue
    }
    for (const subtask of plan.subtasks) {
      if (regex.test(subtask.title) || regex.test(subtask.description)) {
        detected.push(`"${subtask.title}" 匹配敏感模式: ${pattern}`)
        break // One match per pattern is enough
      }
    }
  }
  return detected
}

/** Send the plan to 门下省 for review */
export async function reviewWithMenxia(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan,
  sensitivePatterns: string[],
): Promise<Review> {
  // Code-level sensitive ops detection first
  const codeSensitiveOps = detectSensitiveOps(plan, sensitivePatterns)

  // Create session for menxia
  const session = await client.session.create({
    body: { title: `门下省·审核·${edict.title}` },
  })
  const sessionId = session.data!.id

  const prompt = `请审核以下旨意的规划方案。

## 旨意
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

## 中书省规划方案
${JSON.stringify(plan, null, 2)}

请严格按照你的审核标准（完备性、可行性、风险、效率）进行评审，输出符合 Review 接口的 JSON。`

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "menxia",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  const text = extractText(response.data?.parts ?? [])
  const review = parseReview(text)

  // Merge code-detected sensitive ops
  if (codeSensitiveOps.length > 0) {
    review.sensitiveOps = [...new Set([...review.sensitiveOps, ...codeSensitiveOps])]
  }

  return review
}
