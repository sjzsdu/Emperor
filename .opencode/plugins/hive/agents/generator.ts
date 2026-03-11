import type { AgentConfig } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { buildDomainPrompt, buildQueenPrompt } from "./prompts"

// Color palette for dynamic domains
const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

export function generateAgents(
  domains: Domain[],
  config: HiveConfig,
): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {}

  // Queen (coordinator)
  agents["queen"] = {
    name: "queen",
    description: "Hive Coordinator — analyzes requirements, coordinates domain agents",
    mode: "primary",
    color: "#F59E0B",
    model: config.queen.model,
    prompt: buildQueenPrompt(domains),
  }

  // Domain agents
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]
    agents[domain.id] = {
      name: domain.id,
      description: `${domain.name} — ${domain.description}`,
      mode: "all",
      color: COLORS[i % COLORS.length],
      prompt: buildDomainPrompt(domain),
    }
  }

  return agents
}
