import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { scanProject } from "./scanner"
import { DiscoveryCache } from "./cache"
import { analyzeWithLLM } from "./analyzer"
import { mergeDomains } from "./merger"

export async function discoverDomains(
  directory: string,
  config: HiveConfig,
  client: OpencodeClient,
): Promise<Domain[]> {
  const cache = new DiscoveryCache(directory, config.store.dataDir)
  const scan = scanProject(directory)

  // Check cache
  if (cache.isValid(scan.structureHash)) {
    const cached = cache.load()!
    return mergeDomains(cached.domains, config.domains)
  }

  // Static scan gives immediate results
  let domains = scan.domains

  // LLM enrichment (async, may be slow)
  try {
    domains = await analyzeWithLLM(client, directory, domains, config.discovery.model)
  } catch (err) {
    console.warn(`[hive] LLM analysis failed, using static scan results: ${err}`)
  }

  // Cache results
  cache.save({
    structureHash: scan.structureHash,
    discoveredAt: Date.now(),
    source: "llm",
    domains,
  })

  // Merge with user config
  return mergeDomains(domains, config.domains)
}

export { scanProject } from "./scanner"
export { DiscoveryCache } from "./cache"
export { analyzeWithLLM } from "./analyzer"
export { mergeDomains } from "./merger"
