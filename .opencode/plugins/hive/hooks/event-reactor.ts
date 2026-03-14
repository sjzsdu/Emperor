import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "../eventbus/bus"
import type { Domain } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => (p as any).text)
    .join("\n")
}

const REACTIVE_EVENT_TYPES = [
  "breaking_change",
  "conflict_detected",
] as const

export function createEventReactorHook(
  eventBus: HiveEventBus,
  domains: Domain[],
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
) {
  const processing = new Set<string>()

  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    
    if (input.tool !== "write" && input.tool !== "edit") return

    for (const domain of domains) {
      const pending = eventBus.consume(domain.id)
      const reactive = pending.filter(e =>
        REACTIVE_EVENT_TYPES.includes((e.type as any)) && !processing.has((e as any).id)
      )
      if (reactive.length === 0) continue

      for (const event of reactive) {
        const evt = event as any
        processing.add(evt.id)
        try {
          const session = await client.session.create({
            body: { title: `Hive·${domain.name}·响应·${evt.type}` },
          })
          sessionToDomain.set(session.data!.id, domain.id)

          await client.session.prompt({
            path: { id: session.data!.id },
            body: {
              agent: domain.id,
              parts: [{
                type: "text" as const,
                text:
                  `你收到了一个需要立即响应的事件：\n\n` +
                  `**类型**: ${evt.type}\n` +
                  `**来源**: @${evt.source}\n` +
                  `**内容**: ${evt.payload?.message ?? extractText(evt.payload?.parts ?? [])}\n\n` +
                  `请：\n1. 评估对你领域的影响\n2. 如果需要修改代码，立即执行\n3. 通过 hive_emit 报告处理结果`,
              }],
            },
          })
        } catch {
          // ignore reaction failures
        }
      }
    }
  }
}
