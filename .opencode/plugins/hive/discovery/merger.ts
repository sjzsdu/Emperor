import type { Domain, HiveConfig } from "../types"

export function mergeDomains(
  discovered: Domain[],
  userOverrides: HiveConfig["domains"],
): Domain[] {
  const result: Domain[] = []

  for (const domain of discovered) {
    const override = userOverrides[domain.id]
    if (override?.disabled) continue  // User disabled this domain
    if (override) {
      result.push({ ...domain, ...override })  // User overrides fields
    } else {
      result.push(domain)
    }
  }

  // User-defined domains not in discovered list
  for (const [id, def] of Object.entries(userOverrides)) {
    if (def.disabled) continue
    if (result.some(d => d.id === id)) continue
    // Must have at least paths to be valid
    if (def.paths && def.paths.length > 0) {
      result.push({
        id,
        name: def.name ?? id,
        description: def.description ?? `Domain: ${id}`,
        paths: def.paths,
        techStack: def.techStack ?? "",
        responsibilities: def.responsibilities ?? "",
        interfaces: def.interfaces ?? [],
        dependencies: def.dependencies ?? [],
        conventions: def.conventions ?? [],
      })
    }
  }

  return result
}
