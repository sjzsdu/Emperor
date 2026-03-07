import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { DepartmentId, Edict, Execution, Plan, Subtask } from "../types"

const DEPT_NAMES: Record<DepartmentId, string> = {
  bingbu: "兵部",
  gongbu: "工部",
  lifebu: "礼部",
  xingbu: "刑部",
  hubu: "户部",
  libu: "吏部",
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

/**
 * Group subtasks into execution waves based on dependencies (Kahn's algorithm).
 * Wave 0 = no dependencies, Wave N = depends on waves 0..N-1.
 * If cycle detected, remaining subtasks go into a single final wave.
 */
export function topologicalSort(subtasks: Subtask[]): Subtask[][] {
  if (subtasks.length === 0) return []

  const waves: Subtask[][] = []
  const completed = new Set<number>()
  let remaining = [...subtasks]

  while (remaining.length > 0) {
    const wave = remaining.filter((st) =>
      st.dependencies.every((dep) => completed.has(dep)),
    )

    if (wave.length === 0) {
      // Cycle detected — put all remaining in one wave
      waves.push(remaining)
      break
    }

    waves.push(wave)
    for (const st of wave) {
      completed.add(st.index)
    }
    remaining = remaining.filter((st) => !completed.has(st.index))
  }

  return waves
}

/** Execute a single subtask by creating a session for the assigned department */
export async function executeSubtask(
  client: OpencodeClient,
  edict: Edict,
  subtask: Subtask,
): Promise<Execution> {
  const deptName = DEPT_NAMES[subtask.department] ?? subtask.department
  const execution: Execution = {
    department: subtask.department,
    subtaskIndex: subtask.index,
    sessionId: "",
    status: "running",
    startedAt: Date.now(),
  }

  try {
    const session = await client.session.create({
      body: { title: `${deptName}·${subtask.title}` },
    })
    execution.sessionId = session.data!.id

    const prompt = `你正在执行一个旨意的子任务。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 你的任务
**${subtask.title}**

${subtask.description}

工作量评估: ${subtask.effort}

请执行以上任务并详细报告执行结果。`

    const response = await client.session.prompt({
      path: { id: execution.sessionId },
      body: {
        agent: subtask.department,
        parts: [{ type: "text" as const, text: prompt }],
      },
    })

    execution.result = extractText(response.data?.parts ?? [])
    execution.status = "completed"
    execution.completedAt = Date.now()
  } catch (err) {
    execution.status = "failed"
    execution.error = err instanceof Error ? err.message : String(err)
    execution.completedAt = Date.now()
  }

  return execution
}

/**
 * Sort subtasks into waves and execute each wave in parallel.
 * Failed subtasks are marked but don't block other subtasks.
 */
export async function dispatchAndExecute(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan,
): Promise<Execution[]> {
  const waves = topologicalSort(plan.subtasks)
  const allExecutions: Execution[] = []

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map((subtask) => executeSubtask(client, edict, subtask)),
    )
    allExecutions.push(...waveResults)
  }

  return allExecutions
}
