import matter from 'gray-matter'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { SkillInfo, SkillFrontmatter } from './types.ts'

const SIDE_FILE_NAMES = [
  'references/checklist.md',
  'references/layouts.md',
  'references/context.md',
  'assets/template.html',
]

async function loadSideFiles(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  await Promise.all(
    SIDE_FILE_NAMES.map(async (rel) => {
      const full = path.join(dir, rel)
      if (existsSync(full)) {
        result[rel] = await readFile(full, 'utf8')
      }
    }),
  )
  return result
}

async function loadSkillDir(
  skillDir: string,
  source: SkillInfo['source'],
): Promise<SkillInfo | null> {
  const skillFile = path.join(skillDir, 'SKILL.md')
  if (!existsSync(skillFile)) return null

  const raw = await readFile(skillFile, 'utf8')
  const { data, content } = matter(raw)
  const fm = data as SkillFrontmatter

  const dirName = path.basename(skillDir)
  const id = fm.name ?? dirName
  const tags = Array.isArray(fm.tags)
    ? fm.tags
    : typeof fm.tags === 'string'
      ? fm.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : []

  const sideFiles = await loadSideFiles(skillDir)

  return {
    id,
    name: fm.name ?? dirName,
    description: fm.description ?? '',
    tags,
    source,
    filePath: skillFile,
    dir: skillDir,
    body: content.trim(),
    sideFiles,
  }
}

/**
 * Load skills from one or more root directories.
 * Roots are ordered by priority: earlier roots shadow later ones on id collision.
 */
export async function loadSkills(roots: string[]): Promise<SkillInfo[]> {
  const seen = new Set<string>()
  const skills: SkillInfo[] = []

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]
    const source: SkillInfo['source'] = i === 0 ? 'user' : 'built-in'

    if (!existsSync(root)) continue

    const entries = await readdir(root, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())

    await Promise.all(
      dirs.map(async (entry) => {
        const skill = await loadSkillDir(path.join(root, entry.name), source)
        if (skill && !seen.has(skill.id)) {
          seen.add(skill.id)
          skills.push(skill)
        }
      }),
    )
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

export function findSkill(skills: SkillInfo[], id: string): SkillInfo | undefined {
  return skills.find((s) => s.id === id)
}
