# Emperor — 三省六部 OpenCode Plugin 设计文档

> 日期: 2026-03-06
> 状态: Approved
> 方案: Tool-Driven 编排 (方案 A)

## 1. 概述

Emperor 是一个 OpenCode plugin，将唐代三省六部的分权制衡思想应用于 AI 多 Agent 协作。核心价值：**制度性审核 + 流程可控 + 并行执行**。

### 定位

- **使用场景**: 通用编程助手（feature 开发、bug fix、重构、文档、安全审计）
- **MVP 范围**: 流转引擎优先，不含 UI 看板
- **审核模式**: 混合（默认自动审核，敏感操作人工审批）
- **部门实现**: 各部门 = OpenCode Agent（独立 prompt/model/tools）

### 与 Edict 的关系

Edict (cft0808/edict) 用 Python + React 构建了完整的三省六部系统（含看板、奏折归档等）。Emperor 取其**架构思想**，以 OpenCode plugin 的形式实现核心流转引擎，不依赖外部后端。

## 2. 总体架构

```
用户 ──→ 太子(primary agent) ──调用 下旨() tool──→ Plugin Engine
                                                    │
                                  ┌─────────────────┴──────────────────┐
                                  │          Plugin 内部编排             │
                                  │                                     │
                                  │  ① SDK → 中书省 session.prompt()    │
                                  │     ↓ 规划方案 (structured JSON)     │
                                  │  ② SDK → 门下省 session.prompt()    │
                                  │     ├─ 封驳 → 回 ① (max 3次)       │
                                  │     ├─ 敏感 → context.ask(用户确认)  │
                                  │     └─ 准奏 ↓                      │
                                  │  ③ 并行创建六部 sessions             │
                                  │     Promise.all([部门.prompt()...]) │
                                  │  ④ 汇总结果 → 格式化奏折             │
                                  └────────────────┬────────────────────┘
                                                   │
                                  返回 tool output ──→ 用户看到结果
```

关键设计决策：
- 三省（中书/门下/尚书）的编排逻辑是 **TypeScript 代码**，不是 LLM prompt
- 尚书省的"派发"逻辑在代码中实现（dispatcher），不需要独立 agent
- 六部的实际工作才交给 LLM session 执行

## 3. Agent 拓扑

| Agent ID   | 角色   | Mode       | 职责                                  | Tools                                    |
|------------|--------|------------|---------------------------------------|------------------------------------------|
| `taizi`    | 太子   | `primary`  | 用户入口，闲聊直答，正事调 `下旨` tool | 全部标准工具 + 下旨/查看奏折/叫停        |
| `zhongshu` | 中书省 | `subagent` | 接旨→分析→拆解子任务→指定部门          | read, grep, glob（只读分析）             |
| `menxia`   | 门下省 | `subagent` | 审核中书方案→准奏/封驳                 | read（只读）                             |
| `bingbu`   | 兵部   | `subagent` | 代码实现、bug fix、算法                | 全部标准工具                             |
| `gongbu`   | 工部   | `subagent` | CI/CD、Docker、构建配置                | 全部标准工具                             |
| `libu`     | 礼部   | `subagent` | 文档、API spec、注释                   | 全部标准工具                             |
| `xingbu`   | 刑部   | `subagent` | 安全审计、代码审查、合规                | read, grep（只读 + 分析）                |
| `hubu`     | 户部   | `subagent` | 数据分析、测试、报表                    | 全部标准工具                             |

## 4. Plugin 文件结构

```
.opencode/plugins/emperor/
├── index.ts           # Plugin 入口，注册 hooks + tools
├── tools/
│   ├── edict.ts       # 下旨 tool — 核心编排入口
│   ├── memorial.ts    # 查看奏折 tool — 查看历史
│   └── halt.ts        # 叫停 tool — 中断执行
├── engine/
│   ├── pipeline.ts    # 流转管线：中书→门下→六部→汇总
│   ├── dispatcher.ts  # 尚书省逻辑：根据 plan 派发到六部
│   ├── reviewer.ts    # 门下省逻辑：自动审核 + 人工审批判断
│   └── state.ts       # 任务状态机
├── agents/
│   └── prompts.ts     # 各 agent 的 system prompt 常量
├── store.ts           # 奏折存储（JSON file based）
└── types.ts           # 全局类型定义
```

## 5. 任务状态机

```
RECEIVED → PLANNING → REVIEWING → DISPATCHED → EXECUTING → COMPLETED
              ↑            │
              └─ REJECTED ─┘ (封驳，max 3 次)
                           │
                           ├→ NEEDS_APPROVAL → DISPATCHED (用户确认)
                           │                 → DENIED (用户拒绝)
                           │
                           └→ (3 次封驳) → FAILED
                                           ↑
                             执行失败 ──────┘
                             用户叫停 → HALTED
```

```typescript
type EdictStatus =
  | "received"       // 太子分拣完毕，进入流程
  | "planning"       // 中书省规划中
  | "reviewing"      // 门下省审核中
  | "needs_approval" // 敏感操作，等待用户确认
  | "denied"         // 用户拒绝
  | "rejected"       // 门下省封驳
  | "dispatched"     // 尚书省已派发
  | "executing"      // 六部执行中
  | "completed"      // 全部完成
  | "failed"         // 执行失败
  | "halted"         // 用户叫停
```

## 6. 核心数据结构

```typescript
interface Edict {
  id: string
  title: string
  content: string
  priority: "urgent" | "normal" | "low"
  status: EdictStatus
  createdAt: number
  updatedAt: number
  plan?: Plan
  review?: Review
  executions: Execution[]
  memorial?: string
}

interface Plan {
  analysis: string
  subtasks: Subtask[]
  risks: string[]
  attempt: number
}

interface Subtask {
  index: number
  department: DepartmentId
  title: string
  description: string
  dependencies: number[]
  effort: "low" | "medium" | "high"
}

interface Review {
  verdict: "approve" | "reject"
  reasons: string[]
  suggestions: string[]
  sensitiveOps: string[]
}

interface Execution {
  department: DepartmentId
  subtaskIndex: number
  sessionId: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

type DepartmentId = "bingbu" | "gongbu" | "libu" | "xingbu" | "hubu"
```

## 7. Custom Tools

### 7.1 下旨 (edict)

核心编排入口。太子 agent 判断用户需求为复杂任务时调用。

```typescript
tool({
  description: `下旨：将复杂任务交由三省六部协作完成。
当用户需求涉及多个方面（如代码实现+文档+安全审查+基建）时使用。
单一简单任务请直接处理，不要下旨。`,
  args: {
    title: tool.schema.string().describe("旨意标题，10字以内"),
    content: tool.schema.string().describe("旨意完整内容"),
    priority: tool.schema.enum(["urgent", "normal", "low"]).default("normal"),
  },
  async execute(args, context) {
    // → pipeline.run(edict, context, client)
    // → 返回格式化奏折
  }
})
```

### 7.2 查看奏折 (memorial)

查看历史旨意的执行记录。

```typescript
tool({
  description: "查看历史旨意的执行记录和奏折",
  args: {
    id: tool.schema.string().optional().describe("旨意 ID，不填则列出全部"),
  },
  async execute(args, context) { /* 从 store 读取 */ }
})
```

### 7.3 叫停 (halt)

中断正在执行的旨意。

```typescript
tool({
  description: "叫停正在执行的旨意",
  args: {
    id: tool.schema.string().describe("要叫停的旨意 ID"),
    reason: tool.schema.string().optional(),
  },
  async execute(args, context) { /* 更新状态 + abort sessions */ }
})
```

## 8. Pipeline 流程

```typescript
async function runPipeline(edict, context, client): Promise<string> {
  // Phase 1: 中书省规划
  for (let attempt = 1; attempt <= 3; attempt++) {
    const plan = await planWithZhongshu(client, edict, attempt)

    // Phase 2: 门下省审核
    const review = await reviewWithMenxia(client, edict, plan)

    if (review.verdict === "approve") {
      // 敏感操作检查 → context.ask() 人工确认
      if (review.sensitiveOps.length > 0) {
        await context.ask({ permission: "edict.sensitive", ... })
      }
      break
    }
    // 封驳 → 下轮循环重新规划
  }

  // Phase 3: 尚书省派发 + 六部并行执行
  const waves = topologicalSort(plan.subtasks)
  for (const wave of waves) {
    await Promise.all(wave.map(st => executeSubtask(client, edict, st)))
  }

  // Phase 4: 汇总奏折
  return formatMemorial(edict, plan, results)
}
```

### 中书省 SDK 调用

```typescript
async function planWithZhongshu(client, edict, attempt) {
  const session = await client.session.create({ body: { title: `中书省·${edict.title}` } })
  const prompt = attempt === 1
    ? `规划以下旨意:\n${edict.content}`
    : `上次方案被封驳，原因：${reasons}\n请重新规划:\n${edict.content}`
  await client.session.prompt({ path: { id: session.data.id }, body: { content: ..., agent: "zhongshu" } })
  return parsePlan(messages)
}
```

### 六部并行执行

按依赖拓扑排序，同波次内 Promise.all 并行：

```typescript
async function dispatchAndExecute(client, edict, plan) {
  const waves = topologicalSort(plan.subtasks)
  const results = []
  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(subtask => executeSubtask(client, edict, subtask))
    )
    results.push(...waveResults)
  }
  return results
}
```

## 9. 门下省审核逻辑

混合审核模式：

1. **代码规则检查**：正则匹配敏感操作关键词
2. **LLM 审核**：门下省 agent 评估方案质量
3. **人工审批**：敏感操作触发 `context.ask()`

```typescript
const SENSITIVE_PATTERNS = [
  /删除|remove|delete|drop/i,
  /数据库.*迁移|migration/i,
  /密钥|secret|credential|password/i,
  /生产环境|production|deploy/i,
  /权限|permission|auth.*config/i,
]
```

门下省审核标准：
- 完备性：是否覆盖旨意全部需求
- 可行性：子任务描述是否清晰，部门分配是否合理
- 风险：是否遗漏安全、兼容性、性能风险
- 效率：任务拆解粒度是否适当

## 10. 错误处理

| 场景 | 处理方式 |
|------|---------|
| 中书省输出格式错误 | 重试 1 次附带格式提示；再失败降级为纯文本 |
| 门下省连续封驳 3 次 | 终止流程，向用户报告原因 |
| 单个部门执行失败 | 标记该子任务失败，继续其他部门，最终报告注明 |
| 全部部门执行失败 | 标记旨意 failed，返回所有错误 |
| Session 创建失败 | 最多重试 2 次，失败则终止 |
| 用户叫停 (halt tool) | 更新状态 halted，abort 活跃 sessions |
| AbortSignal 触发 | 各阶段检查 `context.abort.aborted`，及时退出 |
| JSON 解析失败 | Regex fallback 提取关键信息 |

## 11. 持久化

旨意和奏折存储在 `.opencode/plugins/emperor/data/edicts.json`：

```json
{
  "edicts": [
    {
      "id": "edict_001",
      "title": "加上 JWT 认证",
      "status": "completed",
      "createdAt": 1741234567890,
      "plan": { "analysis": "...", "subtasks": [...] },
      "review": { "verdict": "approve", "reasons": [...] },
      "executions": [
        { "department": "bingbu", "status": "completed", "result": "..." }
      ],
      "memorial": "..."
    }
  ]
}
```

## 12. 配置

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["emperor"],
  "agent": {
    "taizi":    { "mode": "primary",  "model": "anthropic/claude-sonnet-4-5", "prompt": "..." },
    "zhongshu": { "mode": "subagent", "model": "anthropic/claude-sonnet-4-5", "prompt": "...", "tools": { "read": true, "grep": true, "glob": true } },
    "menxia":   { "mode": "subagent", "model": "anthropic/claude-sonnet-4-5", "prompt": "...", "tools": { "read": true } },
    "bingbu":   { "mode": "subagent", "model": "anthropic/claude-sonnet-4-5", "prompt": "...", "description": "兵部·代码实现" },
    "gongbu":   { "mode": "subagent", "prompt": "...", "description": "工部·基建" },
    "libu":     { "mode": "subagent", "prompt": "...", "description": "礼部·文档" },
    "xingbu":   { "mode": "subagent", "prompt": "...", "description": "刑部·安全审计", "tools": { "read": true, "grep": true } },
    "hubu":     { "mode": "subagent", "prompt": "...", "description": "户部·数据与测试" }
  }
}
```

## 13. 后续扩展 (Phase 2+)

- Event-Driven 进度通知（TUI toast 显示各阶段状态）
- 奏折 Markdown 导出
- Agent 绩效统计（Token 消耗、成功率）
- 人工御批模式（所有任务都需要用户确认）
- 圣旨模板库
- 六部间协作（部门之间可以互相请求协助）
