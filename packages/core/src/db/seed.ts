/**
 * Seed the database from a directory of resource files.
 *
 * Expected layout:
 *   <initDir>/
 *     agents/      *.md   → agents table
 *     skills/      *.md   → skills table
 *     mcps/        *.json → mcp_servers table
 *     contexts/    *      → context_files table
 *
 * MCP JSON shape:
 *   {
 *     "id": "github",
 *     "name": "GitHub MCP",
 *     "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
 *     "env": { "GITHUB_TOKEN": "" }
 *   }
 *
 * All operations are upserts — safe to run multiple times.
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import { upsertAgent, upsertSkill, upsertMcpServer, upsertContextFile } from './index.ts'

export interface SeedResult {
  agents: number
  skills: number
  mcps: number
  contextFiles: number
  errors: string[]
}

function slugify(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function readDir(dir: string, exts: string[]): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  return entries
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => path.join(dir, f))
}

export async function seedFromDirectory(
  db: Database,
  initDir: string,
): Promise<SeedResult> {
  const result: SeedResult = { agents: 0, skills: 0, mcps: 0, contextFiles: 0, errors: [] }

  // ── Agents ──────────────────────────────────────────────────────────────────
  for (const file of await readDir(path.join(initDir, 'agents'), ['.md', '.txt'])) {
    try {
      const content = await readFile(file, 'utf8')
      const id = slugify(file)
      const name = path.basename(file, path.extname(file))
      upsertAgent(db, { id, name, content })
      result.agents++
    } catch (e) {
      result.errors.push(`agent ${file}: ${(e as Error).message}`)
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────────────
  for (const file of await readDir(path.join(initDir, 'skills'), ['.md', '.txt'])) {
    try {
      const content = await readFile(file, 'utf8')
      const id = slugify(file)
      const name = path.basename(file, path.extname(file))
      upsertSkill(db, { id, name, content })
      result.skills++
    } catch (e) {
      result.errors.push(`skill ${file}: ${(e as Error).message}`)
    }
  }

  // ── MCP servers ───────────────────────────────────────────────────────────────
  for (const file of await readDir(path.join(initDir, 'mcps'), ['.json'])) {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('must be a JSON object')
      }
      const obj = parsed as Record<string, unknown>
      const id = typeof obj.id === 'string' ? obj.id.trim() : slugify(file)
      if (!id) throw new Error('missing id')
      const name = typeof obj.name === 'string' ? obj.name.trim() : id
      if (!Array.isArray(obj.command) || obj.command.length === 0) {
        throw new Error('command must be a non-empty array')
      }
      const command = (obj.command as unknown[]).map(String)
      const env = obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)
        ? (obj.env as Record<string, string>)
        : undefined
      upsertMcpServer(db, { id, name, command, env })
      result.mcps++
    } catch (e) {
      result.errors.push(`mcp ${file}: ${(e as Error).message}`)
    }
  }

  // ── Context files ─────────────────────────────────────────────────────────────
  for (const file of await readDir(path.join(initDir, 'contexts'), ['.md', '.txt', '.yaml', '.json'])) {
    try {
      const content = await readFile(file, 'utf8')
      const id = slugify(file)
      const name = path.basename(file)
      upsertContextFile(db, { id, name, content })
      result.contextFiles++
    } catch (e) {
      result.errors.push(`context ${file}: ${(e as Error).message}`)
    }
  }

  return result
}
