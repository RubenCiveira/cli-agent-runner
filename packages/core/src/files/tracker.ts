import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export type ChangeType = 'added' | 'modified' | 'deleted'

export interface FileChange {
  /** Path relative to the project root */
  path: string
  type: ChangeType
  /** Unified diff string for text files; null for binary or files exceeding the size limit */
  diff: string | null
}

// ── Configuration ─────────────────────────────────────────────────────────────

/** Directory/file name segments that are never tracked */
const EXCLUDE_SEGMENTS = new Set([
  'node_modules', '.git', '.runner', '.next', '.nuxt',
  'dist', 'build', 'out', '__pycache__', '.cache',
  '.turbo', 'coverage', '.DS_Store',
])

/** Max bytes per file to compute a text diff; larger files are noted but not diffed */
const MAX_DIFF_BYTES = 512 * 1024 // 512 KB

/** Max lines per file for the LCS algorithm */
const MAX_DIFF_LINES = 4_000

// ── Types ────────────────────────────────────────────────────────────────────

interface SnapshotEntry {
  hash: string
  content: Buffer
}

/** In-memory snapshot: relative path → file state */
export type Snapshot = Map<string, SnapshotEntry>

// ── Filesystem helpers ────────────────────────────────────────────────────────

function isExcluded(relPath: string): boolean {
  return relPath.split(path.sep).some((seg) => EXCLUDE_SEGMENTS.has(seg))
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex')
}

function isTextBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(8192, buf.length))
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false
  }
  return true
}

async function walkDir(root: string, result: Snapshot): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(root, entry.name)
      const rel = path.relative(root, full)
      if (isExcluded(rel)) return
      if (entry.isDirectory()) {
        await walkDir(full, result)
      } else if (entry.isFile()) {
        const content = await readFile(full)
        result.set(rel, { hash: sha1(content), content })
      }
    }),
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Walk the project root and return a snapshot of every tracked file.
 * Call this **before** invoking the agent.
 */
export async function takeSnapshot(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map()
  if (!existsSync(root)) return snapshot
  await walkDir(root, snapshot)
  return snapshot
}

/**
 * Re-walk the project root, compare with `before`, and return the list of changes.
 * Call this **after** the agent run completes.
 */
export async function computeChanges(
  root: string,
  before: Snapshot,
): Promise<FileChange[]> {
  const after: Snapshot = new Map()
  if (existsSync(root)) await walkDir(root, after)

  const changes: FileChange[] = []

  for (const [rel, bEntry] of before) {
    const aEntry = after.get(rel)
    if (!aEntry) {
      changes.push({ path: rel, type: 'deleted', diff: buildDeletedDiff(rel, bEntry) })
    } else if (aEntry.hash !== bEntry.hash) {
      changes.push({ path: rel, type: 'modified', diff: buildDiff(rel, bEntry, aEntry) })
    }
  }

  for (const [rel, aEntry] of after) {
    if (!before.has(rel)) {
      changes.push({ path: rel, type: 'added', diff: buildAddedDiff(rel, aEntry) })
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

// ── Diff builders ─────────────────────────────────────────────────────────────

function buildDiff(
  rel: string,
  before: SnapshotEntry,
  after: SnapshotEntry,
): string | null {
  if (!isTextBuffer(before.content) || !isTextBuffer(after.content)) {
    return `Binary file changed: ${rel}`
  }
  if (before.content.length > MAX_DIFF_BYTES || after.content.length > MAX_DIFF_BYTES) {
    return `File too large to diff (${before.content.length} → ${after.content.length} bytes): ${rel}`
  }
  const beforeLines = before.content.toString('utf8').split('\n')
  const afterLines = after.content.toString('utf8').split('\n')
  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    return `File too large to diff (${beforeLines.length} → ${afterLines.length} lines): ${rel}`
  }
  return unifiedDiff(beforeLines, afterLines, rel)
}

function buildAddedDiff(rel: string, entry: SnapshotEntry): string | null {
  if (!isTextBuffer(entry.content)) return `Binary file added: ${rel}`
  if (entry.content.length > MAX_DIFF_BYTES) {
    return `Large file added (${entry.content.length} bytes): ${rel}`
  }
  const lines = entry.content.toString('utf8').split('\n')
  return unifiedDiff([], lines, rel)
}

function buildDeletedDiff(rel: string, entry: SnapshotEntry): string | null {
  if (!isTextBuffer(entry.content)) return `Binary file deleted: ${rel}`
  if (entry.content.length > MAX_DIFF_BYTES) {
    return `Large file deleted (${entry.content.length} bytes): ${rel}`
  }
  const lines = entry.content.toString('utf8').split('\n')
  return unifiedDiff(lines, [], rel)
}

// ── Unified diff ──────────────────────────────────────────────────────────────

interface EditOp {
  type: '=' | '+' | '-'
  line: string
}

/**
 * O(n·m) LCS-based edit script.
 * Practical for source files under MAX_DIFF_LINES.
 */
function editScript(a: string[], b: string[]): EditOp[] {
  const m = a.length
  const n = b.length

  // dp[i][j] = LCS length for a[0..i-1], b[0..j-1]
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  const ops: EditOp[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: '=', line: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: '+', line: b[j - 1] })
      j--
    } else {
      ops.unshift({ type: '-', line: a[i - 1] })
      i--
    }
  }
  return ops
}

interface Hunk {
  aStart: number // 1-based
  aLen: number
  bStart: number
  bLen: number
  lines: string[] // prefixed with ' ', '+', '-'
}

function buildHunks(ops: EditOp[], context = 3): Hunk[] {
  const hunks: Hunk[] = []
  let aLine = 0 // position in 'before' (0-based)
  let bLine = 0 // position in 'after'  (0-based)

  // Identify ranges of non-context ops and group with surrounding context
  const changed: number[] = []
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type !== '=') changed.push(idx)
  }
  if (changed.length === 0) return hunks

  // Merge ranges separated by <= 2*context equal lines
  const ranges: Array<[number, number]> = []
  let start = changed[0]
  let end = changed[0]
  for (let k = 1; k < changed.length; k++) {
    if (changed[k] - end <= 2 * context + 1) {
      end = changed[k]
    } else {
      ranges.push([start, end])
      start = changed[k]
      end = changed[k]
    }
  }
  ranges.push([start, end])

  for (const [rs, re] of ranges) {
    const from = Math.max(0, rs - context)
    const to = Math.min(ops.length - 1, re + context)

    let localA = 0
    let localB = 0
    const lines: string[] = []

    // Count preceding ops for header positions
    let aStart = 1
    let bStart = 1
    for (let idx = 0; idx < from; idx++) {
      if (ops[idx].type !== '+') aStart++
      if (ops[idx].type !== '-') bStart++
    }

    for (let idx = from; idx <= to; idx++) {
      const op = ops[idx]
      if (op.type === '=') {
        lines.push(' ' + op.line)
        localA++
        localB++
      } else if (op.type === '-') {
        lines.push('-' + op.line)
        localA++
      } else {
        lines.push('+' + op.line)
        localB++
      }
    }

    hunks.push({ aStart, aLen: localA, bStart, bLen: localB, lines })
  }

  return hunks
}

function unifiedDiff(before: string[], after: string[], filename: string): string {
  const ops = editScript(before, after)
  const hunks = buildHunks(ops)
  if (hunks.length === 0) return ''

  const header =
    before.length === 0
      ? `--- /dev/null\n+++ b/${filename}`
      : after.length === 0
        ? `--- a/${filename}\n+++ /dev/null`
        : `--- a/${filename}\n+++ b/${filename}`

  const body = hunks
    .map(
      (h) =>
        `@@ -${h.aStart},${h.aLen} +${h.bStart},${h.bLen} @@\n` + h.lines.join('\n'),
    )
    .join('\n')

  return `${header}\n${body}`
}
