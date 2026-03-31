import { execSync } from 'node:child_process'
import path from 'node:path'

export interface AuthorStats {
  linesAdded: number
  linesRemoved: number
  totalLines: number
}

export interface FileReport {
  path: string
  authors: Record<string, AuthorStats>
  uniqueAuthors: number
  topContributor: string
  topContributorShare: number
  siloScore: number
  exclusiveAuthor: string | null
}

export interface DirectoryReport {
  path: string
  authors: Record<string, AuthorStats>
  uniqueAuthors: number
  topContributor: string
  topContributorShare: number
  siloScore: number
  fileCount: number
}

export interface SiloReport {
  generatedAt: string
  repoRoot: string
  files: FileReport[]
  directories: DirectoryReport[]
}

interface RawCommit {
  author: string
  files: { added: number; removed: number; path: string }[]
}

/** Parse git log --numstat output into structured commits */
export function parseGitLog(raw: string): RawCommit[] {
  const commits: RawCommit[] = []
  const blocks = raw.split('\n---END---\n').filter(b => b.trim())

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length === 0) continue

    const author = lines[0].trim()
    if (!author) continue

    const files: RawCommit['files'] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (match) {
        const added = match[1] === '-' ? 0 : parseInt(match[1], 10)
        const removed = match[2] === '-' ? 0 : parseInt(match[2], 10)
        files.push({ added, removed, path: match[3] })
      }
    }

    if (files.length > 0) {
      commits.push({ author, files })
    }
  }

  return commits
}

/** Aggregate commits into per-file author stats */
export function aggregateFileStats(commits: RawCommit[]): Map<string, Record<string, AuthorStats>> {
  const fileMap = new Map<string, Record<string, AuthorStats>>()

  for (const commit of commits) {
    for (const file of commit.files) {
      if (!fileMap.has(file.path)) {
        fileMap.set(file.path, {})
      }
      const authors = fileMap.get(file.path)!
      if (!authors[commit.author]) {
        authors[commit.author] = { linesAdded: 0, linesRemoved: 0, totalLines: 0 }
      }
      authors[commit.author].linesAdded += file.added
      authors[commit.author].linesRemoved += file.removed
      authors[commit.author].totalLines += file.added + file.removed
    }
  }

  return fileMap
}

/** Compute silo score using HHI (Herfindahl-Hirschman Index) */
export function computeSiloScore(authors: Record<string, AuthorStats>): number {
  const entries = Object.values(authors)
  if (entries.length === 0) return 0

  const total = entries.reduce((sum, a) => sum + a.totalLines, 0)
  if (total === 0) return 0

  const hhi = entries.reduce((sum, a) => {
    const share = a.totalLines / total
    return sum + share * share
  }, 0)

  return hhi
}

/** Build file reports from aggregated stats */
export function buildFileReports(fileMap: Map<string, Record<string, AuthorStats>>): FileReport[] {
  const reports: FileReport[] = []

  for (const [filePath, authors] of fileMap) {
    const entries = Object.entries(authors)
    const uniqueAuthors = entries.length
    const total = entries.reduce((sum, [, a]) => sum + a.totalLines, 0)

    let topContributor = ''
    let topContributorLines = 0
    for (const [name, stats] of entries) {
      if (stats.totalLines > topContributorLines) {
        topContributor = name
        topContributorLines = stats.totalLines
      }
    }

    const topContributorShare = total > 0 ? topContributorLines / total : 0
    const siloScore = computeSiloScore(authors)
    const exclusiveAuthor = uniqueAuthors === 1 ? topContributor : null

    reports.push({
      path: filePath,
      authors,
      uniqueAuthors,
      topContributor,
      topContributorShare,
      siloScore,
      exclusiveAuthor,
    })
  }

  return reports.sort((a, b) => b.siloScore - a.siloScore)
}

/** Aggregate file stats into directory-level stats */
export function buildDirectoryReports(fileReports: FileReport[]): DirectoryReport[] {
  const dirMap = new Map<string, { authors: Record<string, AuthorStats>; fileCount: number }>()

  for (const file of fileReports) {
    const dir = path.dirname(file.path)
    if (!dirMap.has(dir)) {
      dirMap.set(dir, { authors: {}, fileCount: 0 })
    }
    const entry = dirMap.get(dir)!
    entry.fileCount++

    for (const [author, stats] of Object.entries(file.authors)) {
      if (!entry.authors[author]) {
        entry.authors[author] = { linesAdded: 0, linesRemoved: 0, totalLines: 0 }
      }
      entry.authors[author].linesAdded += stats.linesAdded
      entry.authors[author].linesRemoved += stats.linesRemoved
      entry.authors[author].totalLines += stats.totalLines
    }
  }

  const reports: DirectoryReport[] = []
  for (const [dirPath, { authors, fileCount }] of dirMap) {
    const entries = Object.entries(authors)
    const uniqueAuthors = entries.length
    const total = entries.reduce((sum, [, a]) => sum + a.totalLines, 0)

    let topContributor = ''
    let topContributorLines = 0
    for (const [name, stats] of entries) {
      if (stats.totalLines > topContributorLines) {
        topContributor = name
        topContributorLines = stats.totalLines
      }
    }

    const topContributorShare = total > 0 ? topContributorLines / total : 0
    const siloScore = computeSiloScore(authors)

    reports.push({
      path: dirPath,
      authors,
      uniqueAuthors,
      topContributor,
      topContributorShare,
      siloScore,
      fileCount,
    })
  }

  return reports.sort((a, b) => b.siloScore - a.siloScore)
}

/** Run the full analysis on a git repository */
export function analyze(repoPath?: string): SiloReport {
  const cwd = repoPath || process.cwd()
  const raw = execSync(
    'git log --all --numstat --format="%aN%n---END---"',
    { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
  )

  const commits = parseGitLog(raw)
  const fileMap = aggregateFileStats(commits)
  const fileReports = buildFileReports(fileMap)
  const directoryReports = buildDirectoryReports(fileReports)

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: cwd,
    files: fileReports,
    directories: directoryReports,
  }
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('knowledge-silo.ts') || process.argv[1].endsWith('knowledge-silo.js'))) {
  const repoPath = process.argv[2] || process.cwd()
  const report = analyze(repoPath)
  console.log(JSON.stringify(report, null, 2))
}
