import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { scanProject } from "./scanner"
import { DiscoveryCache } from "./cache"
import { analyzeWithLLM } from "./analyzer"
import { mergeDomains } from "./merger"

export function discoverDomains(
  directory: string,
  config: HiveConfig,
  client: OpencodeClient,
): Domain[] {
  const cache = new DiscoveryCache(directory, config.store.dataDir)
  const scan = scanProject(directory)

  // Check cache — if LLM analysis was done before, use it
  if (cache.isValid(scan.structureHash)) {
    const cached = cache.load()!
    return mergeDomains(cached.domains, config.domains)
  }

  // Static scan gives immediate results (never blocks startup)
  const domains = scan.domains

  // Cache static results
  cache.save({
    structureHash: scan.structureHash,
    discoveredAt: Date.now(),
    source: "static",
    domains,
  })

  // Fire LLM enrichment in background — won't block startup
  enrichDomainsInBackground(directory, config, client, cache, scan.structureHash, domains)

  // Return static results immediately
  return mergeDomains(domains, config.domains)
}

function enrichDomainsInBackground(
  directory: string,
  config: HiveConfig,
  client: OpencodeClient,
  cache: DiscoveryCache,
  structureHash: string,
  staticDomains: Domain[],
): void {
  // Skip LLM if autoRefresh disabled
  if (!config.discovery.autoRefresh) {
    return
  }

  analyzeWithLLM(client, directory, staticDomains, config.discovery.model)
    .then((enriched) => {
      cache.save({
        structureHash,
        discoveredAt: Date.now(),
        source: "llm",
        domains: enriched,
      })
    })
    .catch(() => {
      // Silently fail - static results are already being used
    })
}

export { scanProject } from "./scanner"
export { DiscoveryCache } from "./cache"
export { analyzeWithLLM } from "./analyzer"
export { mergeDomains } from "./merger"
