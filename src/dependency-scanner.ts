#!/usr/bin/env npx tsx
/**
 * Dependency Risk Scanner
 *
 * Analyzes package.json and package-lock.json for security and maintenance risks.
 * Checks: known vulnerabilities (npm audit), stale/unmaintained packages,
 * deprecated packages, and license compatibility.
 *
 * Usage: npx tsx src/dependency-scanner.ts [--json] [--threshold-days=730]
 */

import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

interface ScanConfig {
  staleDays: number
  flagSeverities: string[]
  allowedLicenses: string[]
}

interface VulnerabilityInfo {
  severity: string
  title: string
  url: string
  range: string
}

interface DepRiskEntry {
  name: string
  version: string
  isDev: boolean
  vulnerabilities: VulnerabilityInfo[]
  deprecated: string | null
  lastPublish: string | null
  daysSincePublish: number | null
  isStale: boolean
  license: string | null
  licenseRisk: boolean
}

interface ScanReport {
  scannedAt: string
  project: string
  totalDeps: number
  config: ScanConfig
  dependencies: DepRiskEntry[]
  summary: {
    vulnerableCount: number
    deprecatedCount: number
    staleCount: number
    licenseRiskCount: number
  }
}

const DEFAULT_CONFIG: ScanConfig = {
  staleDays: 730,
  flagSeverities: ["low", "moderate", "high", "critical"],
  allowedLicenses: [
    "MIT",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
    "0BSD",
    "BlueOak-1.0.0",
    "Unlicense",
    "CC0-1.0",
  ],
}

function parseArgs(): { json: boolean; config: ScanConfig } {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const config = { ...DEFAULT_CONFIG }

  for (const arg of args) {
    const match = arg.match(/^--threshold-days=(\d+)$/)
    if (match) config.staleDays = parseInt(match[1], 10)
  }

  return { json, config }
}

function readPackageJson(projectDir: string): {
  name: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  const pkgPath = resolve(projectDir, "package.json")
  if (!existsSync(pkgPath)) {
    throw new Error(\`package.json not found at \${pkgPath}\`)
  }
  const raw = JSON.parse(readFileSync(pkgPath, "utf-8"))
  return {
    name: raw.name ?? "unknown",
    dependencies: raw.dependencies ?? {},
    devDependencies: raw.devDependencies ?? {},
  }
}

function runNpmAudit(
  projectDir: string,
): Record<string, VulnerabilityInfo[]> {
  const result: Record<string, VulnerabilityInfo[]> = {}
  try {
    const output = execSync("npm audit --json 2>/dev/null", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30_000,
    })
    const audit = JSON.parse(output)
    const vulns = audit.vulnerabilities ?? {}
    for (const [name, info] of Object.entries<any>(vulns)) {
      const entries: VulnerabilityInfo[] = (info.via ?? [])
        .filter((v: any) => typeof v === "object")
        .map((v: any) => ({
          severity: v.severity ?? info.severity ?? "unknown",
          title: v.title ?? "Unknown vulnerability",
          url: v.url ?? "",
          range: v.range ?? "*",
        }))
      if (entries.length > 0) {
        result[name] = entries
      }
    }
  } catch (e: any) {
    if (e.stdout) {
      try {
        const audit = JSON.parse(e.stdout)
        const vulns = audit.vulnerabilities ?? {}
        for (const [name, info] of Object.entries<any>(vulns)) {
          const entries: VulnerabilityInfo[] = (info.via ?? [])
            .filter((v: any) => typeof v === "object")
            .map((v: any) => ({
              severity: v.severity ?? info.severity ?? "unknown",
              title: v.title ?? "Unknown vulnerability",
              url: v.url ?? "",
              range: v.range ?? "*",
            }))
          if (entries.length > 0) {
            result[name] = entries
          }
        }
      } catch {
        // audit parse failed
      }
    }
  }
  return result
}

async function queryNpmRegistry(
  packageName: string,
): Promise<{
  deprecated: string | null
  lastPublish: string | null
  license: string | null
}> {
  const encoded = packageName.replace("/", "%2F")
  const url = \`https://registry.npmjs.org/\${encoded}\`
  try {
    const res = await fetch(url)
    if (!res.ok) return { deprecated: null, lastPublish: null, license: null }
    const data = await res.json()

    const distTags = data["dist-tags"] ?? {}
    const latestVersion = distTags.latest
    const latestInfo = latestVersion
      ? (data.versions?.[latestVersion] ?? {})
      : {}

    const deprecated =
      typeof latestInfo.deprecated === "string"
        ? latestInfo.deprecated
        : null

    const time = data.time ?? {}
    const lastPublish = time.modified ?? time[latestVersion] ?? null

    const license =
      typeof latestInfo.license === "string"
        ? latestInfo.license
        : typeof data.license === "string"
          ? data.license
          : null

    return { deprecated, lastPublish, license }
  } catch {
    return { deprecated: null, lastPublish: null, license: null }
  }
}

function daysBetween(dateStr: string): number {
  const then = new Date(dateStr).getTime()
  const now = Date.now()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

async function scan(projectDir: string, config: ScanConfig): Promise<ScanReport> {
  const pkg = readPackageJson(projectDir)
  const allDeps: { name: string; version: string; isDev: boolean }[] = []

  for (const [name, version] of Object.entries(pkg.dependencies)) {
    allDeps.push({ name, version, isDev: false })
  }
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    allDeps.push({ name, version, isDev: true })
  }

  const auditResults = runNpmAudit(projectDir)

  const entries: DepRiskEntry[] = await Promise.all(
    allDeps.map(async (dep) => {
      const registry = await queryNpmRegistry(dep.name)
      const daysSincePublish = registry.lastPublish
        ? daysBetween(registry.lastPublish)
        : null
      const isStale =
        daysSincePublish !== null && daysSincePublish > config.staleDays
      const licenseRisk =
        registry.license !== null &&
        !config.allowedLicenses.includes(registry.license)

      return {
        name: dep.name,
        version: dep.version,
        isDev: dep.isDev,
        vulnerabilities: auditResults[dep.name] ?? [],
        deprecated: registry.deprecated,
        lastPublish: registry.lastPublish,
        daysSincePublish,
        isStale,
        license: registry.license,
        licenseRisk,
      }
    }),
  )

  return {
    scannedAt: new Date().toISOString(),
    project: pkg.name,
    totalDeps: allDeps.length,
    config,
    dependencies: entries,
    summary: {
      vulnerableCount: entries.filter((e) => e.vulnerabilities.length > 0).length,
      deprecatedCount: entries.filter((e) => e.deprecated !== null).length,
      staleCount: entries.filter((e) => e.isStale).length,
      licenseRiskCount: entries.filter((e) => e.licenseRisk).length,
    },
  }
}

function printHumanReadable(report: ScanReport): void {
  console.log(\`\\nDependency Risk Report: \${report.project}\`)
  console.log(\`Scanned: \${report.scannedAt}\`)
  console.log(\`Total dependencies: \${report.totalDeps}\\n\`)

  for (const dep of report.dependencies) {
    const flags: string[] = []
    if (dep.vulnerabilities.length > 0)
      flags.push(\`\${dep.vulnerabilities.length} vuln(s)\`)
    if (dep.deprecated) flags.push("DEPRECATED")
    if (dep.isStale) flags.push(\`stale (\${dep.daysSincePublish}d)\`)
    if (dep.licenseRisk) flags.push(\`license: \${dep.license}\`)

    const status = flags.length > 0 ? flags.join(", ") : "ok"
    const devTag = dep.isDev ? " (dev)" : ""
    console.log(\`  \${dep.name}@\${dep.version}\${devTag}: \${status}\`)

    for (const v of dep.vulnerabilities) {
      console.log(\`    - [\${v.severity}] \${v.title} \${v.url}\`)
    }
  }

  const s = report.summary
  console.log(\`\\nSummary:\`)
  console.log(\`  Vulnerable: \${s.vulnerableCount}\`)
  console.log(\`  Deprecated: \${s.deprecatedCount}\`)
  console.log(\`  Stale (>\${report.config.staleDays}d): \${s.staleCount}\`)
  console.log(\`  License risk: \${s.licenseRiskCount}\`)

  const totalRisks =
    s.vulnerableCount + s.deprecatedCount + s.staleCount + s.licenseRiskCount
  if (totalRisks === 0) {
    console.log(\`\\nNo risks detected.\`)
  } else {
    console.log(\`\\nTotal flags: \${totalRisks}\`)
  }
}

async function main() {
  const { json, config } = parseArgs()
  const projectDir = process.cwd()

  const report = await scan(projectDir, config)

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReadable(report)
  }

  const hasRisks =
    report.summary.vulnerableCount > 0 || report.summary.deprecatedCount > 0
  process.exit(hasRisks ? 1 : 0)
}

main()
