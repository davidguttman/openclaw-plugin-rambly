import { describe, it, expect } from 'vitest'
import {
  parseGitLog,
  aggregateFileStats,
  computeSiloScore,
  buildFileReports,
  buildDirectoryReports,
} from './knowledge-silo.ts'

const SAMPLE_LOG = [
  'Alice',
  '10\t5\tsrc/foo.ts',
  '20\t3\tsrc/bar.ts',
  '',
  '---END---',
  '',
  'Bob',
  '2\t1\tsrc/foo.ts',
  '',
  '---END---',
  '',
  'Alice',
  '-\t-\tsrc/image.png',
  '5\t0\tlib/util.ts',
  '',
  '---END---',
  '',
].join('\n')

describe('parseGitLog', () => {
  it('parses commits with author and numstat lines', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    expect(commits.length).toBe(3)
    expect(commits[0].author).toBe('Alice')
    expect(commits[0].files).toHaveLength(2)
    expect(commits[0].files[0]).toEqual({ added: 10, removed: 5, path: 'src/foo.ts' })
  })

  it('handles binary files (- for added/removed)', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const aliceSecond = commits[2]
    expect(aliceSecond.files[0]).toEqual({ added: 0, removed: 0, path: 'src/image.png' })
  })

  it('returns empty array for empty input', () => {
    expect(parseGitLog('')).toEqual([])
  })
})

describe('aggregateFileStats', () => {
  it('aggregates per-file per-author stats', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)

    const fooAuthors = fileMap.get('src/foo.ts')!
    expect(fooAuthors['Alice'].linesAdded).toBe(10)
    expect(fooAuthors['Alice'].linesRemoved).toBe(5)
    expect(fooAuthors['Alice'].totalLines).toBe(15)
    expect(fooAuthors['Bob'].totalLines).toBe(3)
  })

  it('tracks files touched by single author', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)

    const barAuthors = fileMap.get('src/bar.ts')!
    expect(Object.keys(barAuthors)).toEqual(['Alice'])
    expect(barAuthors['Alice'].totalLines).toBe(23)
  })
})

describe('computeSiloScore', () => {
  it('returns 1.0 for single author', () => {
    const score = computeSiloScore({
      Alice: { linesAdded: 10, linesRemoved: 5, totalLines: 15 },
    })
    expect(score).toBe(1)
  })

  it('returns 0.5 for two equal authors', () => {
    const score = computeSiloScore({
      Alice: { linesAdded: 5, linesRemoved: 5, totalLines: 10 },
      Bob: { linesAdded: 5, linesRemoved: 5, totalLines: 10 },
    })
    expect(score).toBe(0.5)
  })

  it('returns 0 for empty authors', () => {
    expect(computeSiloScore({})).toBe(0)
  })

  it('returns higher score for skewed contributions', () => {
    const skewed = computeSiloScore({
      Alice: { linesAdded: 90, linesRemoved: 0, totalLines: 90 },
      Bob: { linesAdded: 10, linesRemoved: 0, totalLines: 10 },
    })
    const equal = computeSiloScore({
      Alice: { linesAdded: 50, linesRemoved: 0, totalLines: 50 },
      Bob: { linesAdded: 50, linesRemoved: 0, totalLines: 50 },
    })
    expect(skewed).toBeGreaterThan(equal)
  })
})

describe('buildFileReports', () => {
  it('sorts by siloScore descending', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)
    const reports = buildFileReports(fileMap)

    for (let i = 1; i < reports.length; i++) {
      expect(reports[i - 1].siloScore).toBeGreaterThanOrEqual(reports[i].siloScore)
    }
  })

  it('sets exclusiveAuthor for single-author files', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)
    const reports = buildFileReports(fileMap)

    const barReport = reports.find(r => r.path === 'src/bar.ts')!
    expect(barReport.exclusiveAuthor).toBe('Alice')

    const fooReport = reports.find(r => r.path === 'src/foo.ts')!
    expect(fooReport.exclusiveAuthor).toBeNull()
  })
})

describe('buildDirectoryReports', () => {
  it('aggregates files in the same directory', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)
    const fileReports = buildFileReports(fileMap)
    const dirReports = buildDirectoryReports(fileReports)

    const srcDir = dirReports.find(r => r.path === 'src')!
    expect(srcDir).toBeDefined()
    expect(srcDir.fileCount).toBe(3)
    expect(srcDir.uniqueAuthors).toBe(2)
  })

  it('separates different directories', () => {
    const commits = parseGitLog(SAMPLE_LOG)
    const fileMap = aggregateFileStats(commits)
    const fileReports = buildFileReports(fileMap)
    const dirReports = buildDirectoryReports(fileReports)

    const libDir = dirReports.find(r => r.path === 'lib')!
    expect(libDir).toBeDefined()
    expect(libDir.fileCount).toBe(1)
    expect(libDir.uniqueAuthors).toBe(1)
  })
})
