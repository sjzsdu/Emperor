import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "./eventbus/bus"
import type { Domain, HiveConfig, PipelineState, PipelineLog, PipelinePhase } from "./types"

// Hive pipeline engine
export class HivePipeline {
  private currentPipeline: PipelineState | null = null

  constructor(
    private eventBus: HiveEventBus,
    private domains: Domain[],
    private client: OpencodeClient,
    private sessionToDomain: Map<string, string>,
    private config: HiveConfig
  ) {}

  getState(): PipelineState | null {
    return this.currentPipeline
  }

  // Helpers
  private log(phase: PipelinePhase, message: string, domain?: string) {
    if (!this.currentPipeline) return
    this.currentPipeline.logs.push({ timestamp: Date.now(), phase, message, domain })
    this.eventBus.publish({
      type: "pipeline_phase",
      source: "queen",
      target: "*",
      payload: { message, data: { phase, domain } },
    })
  }

  private extractText(parts: Part[]): string {
    return parts
      .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
  }

  private parseRelevance(text: string): { relevance: string; analysis: string; workload: string } {
    let relevance = "中"
    let analysis = ""
    let workload = ""
    // Try to extract relevance from lines mentioning 相关性 or relevance
    const lines = text.split(/\n/).map((l) => l.trim())
    for (const line of lines) {
      const m = line.match(/相关性[:：]?\s*([高中低无])/i)
      if (m) {
        relevance = m[1]
        break
      }
    }
    const a = text.match(/初步分析[:：]?\s*([\s\S]*?)(?:$|\n)/i)
    if (a && a[1]) analysis = a[1].trim()
    if (!analysis) {
      // fallback: heuristic from lines with  分析 or analysis
      const a2 = lines.find((l) => /分析|analysis/i.test(l))
      if (a2) analysis = a2
    }
    const w = text.match(/预估工作量[:：]?\s*([\s\S]*?)(?:$|\n)/i)
    if (w && w[1]) workload = w[1].trim()
    if (!workload) {
      const w2 = lines.find((l) => /工作量|workload|work load/i.test(l))
      if (w2) workload = w2
    }
    if (!analysis) analysis = text
    if (!workload) workload = "中"
    if (!/^[高中低无]$/.test(relevance)) relevance = "中"
    return { relevance, analysis, workload }
  }

  async run(requirement: string): Promise<string> {
    // initialize pipeline state
    const id = `pipeline-${Date.now()}`
    const startedAt = Date.now()
    this.currentPipeline = {
      id,
      requirement,
      status: "running",
      startedAt,
      logs: [],
      assessments: [],
      dispatched: [],
    }

    // announce start
    this.eventBus.publish({
      type: "pipeline_started",
      source: "queen",
      target: "*",
      payload: { message: `Pipeline started for: ${requirement}` },
    })

    // Phase 1: Assess (parallel)
    const assessResults = await Promise.allSettled(
      this.domains.map(async (domain) => {
        const session = await this.client.session.create({ body: { title: `Hive·${domain.name}·评估` } })
        const sessionId = session.data!.id
        this.sessionToDomain.set(sessionId, domain.id)
        const prompt = `以下是一个新的需求，请评估是否与你的领域相关，以及你需要做什么：\n\n## 需求\n${requirement}\n\n请返回以下格式：\n- **相关性**: 高/中/低/无\n- **初步分析**: 你需要做什么（如果相关）\n- **预估工作量**: 低/中/高\n- **需要协调的Domain**: 如果需要其他Domain配合，列出domain id`
        const resp = await this.client.session.prompt({ path: { id: sessionId }, body: { agent: domain.id, parts: [{ type: "text" as const, text: prompt }] } })
        const text = this.extractText(resp.data?.parts ?? [])
        const { relevance, analysis, workload } = this.parseRelevance(text)
        this.currentPipeline!.assessments.push({ domain: domain.id, relevance, analysis, workload })
        this.log("assess", `✅ @${domain.id} 评估完成: ${relevance}相关`, domain.id)
        return { domain: domain.id, relevance, analysis, workload }
      })
    )
    // Phase 2: Filter
    const relevant = this.currentPipeline!.assessments.filter((a) => a.relevance !== "低" && a.relevance !== "无")
    const relevantDomains = relevant.map((r) => r.domain)
    if (relevantDomains.length === 0) {
      this.log("filter", `筛选出 0 个相关域: 无相关域`)
      this.currentPipeline!.status = "completed"
      this.currentPipeline!.completedAt = Date.now()
      this.eventBus.publish({ type: "pipeline_completed", source: "queen", target: "*", payload: { message: `Pipeline completed: no relevant domains` } })
      const duration = (Date.now() - startedAt) / 1000
      return `# Hive Pipeline\n\n没有发现相关域。耗时 ${duration.toFixed(2)}s`
    }

    // Phase 3: Negotiate (between relevant domains that depend on each other)
    const domainMap = new Map<string, Domain>()
    this.domains.forEach((d) => domainMap.set(d.id, d))
    const pairs: Array<{ a: string; b: string; topic: string }> = []
    for (let i = 0; i < relevant.length; i++) {
      for (let j = i + 1; j < relevant.length; j++) {
        const a = relevant[i].domain
        const b = relevant[j].domain
        const da = domainMap.get(a)!
        const db = domainMap.get(b)!
        const hasDep = da.dependencies.includes(b) || db.dependencies.includes(a)
        if (hasDep) {
          pairs.push({ a, b, topic: `接口协商: ${a} 与 ${b}` })
        }
      }
    }
    if (pairs.length > 0) {
      // Lightweight negotiation: publish interface_proposal and accept/confirm
      for (const pr of pairs) {
        this.eventBus.publish({
          type: "interface_proposal",
          source: pr.a,
          target: pr.b,
          payload: { message: `Negotiation: ${pr.topic}` },
        })
        // Auto-accept for this autonomous pipeline in this simplified implementation
        this.eventBus.publish({
          type: "interface_accepted",
          source: pr.b,
          target: pr.a,
          payload: { message: `Interface ${pr.topic} accepted by ${pr.b}` },
        })
        this.log("negotiate", `协商结果: ${pr.a} ↔ ${pr.b} 已达成接口`, pr.a)
      }
    }

    // Phase 4: Dispatch (parallel waves respecting dependencies)
    const relevantSet = new Set<string>(relevantDomains)
    // Build internal dependency map
    const internalDeps = new Map<string, string[]>()
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      internalDeps.set(d.id, d.dependencies.filter((dep) => relevantSet.has(dep)))
    })
    // Build adjacency for topological waves
    const adj = new Map<string, string[]>()
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      adj.set(d.id, [])
    })
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      d.dependencies.forEach((dep) => {
        if (relevantSet.has(dep)) {
          const arr = adj.get(dep) ?? []
          arr.push(d.id)
          adj.set(dep, arr)
        }
      })
    })
    const indegree = new Map<string, number>()
    relevantDomains.forEach((id) => {
      indegree.set(id, (internalDeps.get(id) ?? []).length)
    })
    let queueWave = relevantDomains.filter((id) => (internalDeps.get(id) ?? []).length === 0)
    const waves: string[][] = []
    while (queueWave.length > 0) {
      const thisWave = [...queueWave]
      waves.push(thisWave)
      const next: string[] = []
      for (const u of thisWave) {
        const outs = adj.get(u) ?? []
        for (const v of outs) {
          const cnt = (indegree.get(v) ?? 0) - 1
          indegree.set(v, cnt)
          if (cnt === 0) next.push(v)
        }
      }
      queueWave = next
    }
    // Execute waves sequentially
    for (const wave of waves) {
      await Promise.all(
        wave.map(async (domainId) => {
          const domain = this.domains.find((d) => d.id === domainId)!
          const session = await this.client.session.create({ body: { title: `Hive·${domain.name}·执行` } })
          const sessionId = session.data!.id
          this.sessionToDomain.set(sessionId, domainId)
          const instruction = `请基于需求执行实现：\n${requirement}\n\n请在实现过程中遵循领域约束与协商结果。`
          const resp = await this.client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: domainId,
              parts: [{ type: "text" as const, text: instruction }],
            },
          })
          const text = this.extractText(resp.data?.parts ?? [])
          const lineChanges = /files changed\s+(\d+)/i.exec(text)
          this.currentPipeline!.dispatched.push({ domain: domainId, status: "completed", response: text })
          this.log(
            "dispatch",
            `域 ${domainId} 完成执行${lineChanges ? ` (${lineChanges[1]} files changed)` : ""}`,
            domainId
          )
        })
      )
      // after wave, publish phase
      this.eventBus.publish({ type: "pipeline_phase", source: "queen", target: "*", payload: { message: `Wave completed: ${wave.join(",")}` } })
    }

    // Phase 5: Report
    const end = Date.now()
    const duration = (end - startedAt) / 1000
    this.currentPipeline!.status = "completed"
    this.currentPipeline!.completedAt = end
    const summary = `# Hive Pipeline Report\n\n- Requirement: ${requirement}\n- Related domains: ${relevantDomains.length} (${relevantDomains.join(", ")})\n- Duration: ${duration.toFixed(2)}s\n`
    const perDomain = this.currentPipeline!.dispatched.map((d) => `- @${d.domain}: ${d.status}\n  ${d.response?.slice(0, 200) ?? ""}`)
    const report = summary + "\n## Per-domain results\n" + perDomain.join("\n\n")
    this.currentPipeline!.status = "completed"
    this.currentPipeline!.completedAt = Date.now()
    this.eventBus.publish({ type: "pipeline_completed", source: "queen", target: "*", payload: { message: `Pipeline completed`, data: { requirement, domains: relevantDomains } } })
    return report
  }
}

export type { PipelineState }
