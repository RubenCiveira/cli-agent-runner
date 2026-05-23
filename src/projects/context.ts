import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Files checked in order — first match wins */
const CONTEXT_FILE_CANDIDATES = ['CONTEXT.md', 'AGENTS.md', 'CLAUDE.md']

/** Local skills directory inside a project */
export const PROJECT_SKILLS_DIR = '.runner/skills'

export interface ProjectContext {
  /** Absolute path of the file that was loaded, or null if none found */
  file: string | null
  /** File content, or empty string if none found */
  content: string
}

/**
 * Load the first context file found in the project root.
 * Search order: CONTEXT.md → AGENTS.md → CLAUDE.md
 */
export async function loadProjectContext(projectPath: string): Promise<ProjectContext> {
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    const full = path.join(projectPath, candidate)
    if (existsSync(full)) {
      const content = await readFile(full, 'utf8')
      return { file: full, content }
    }
  }
  return { file: null, content: '' }
}

/**
 * Return the path to the project-local skills directory.
 * Callers should pass this as the first root to loadSkills() so
 * project skills take priority over global built-in skills.
 */
export function projectSkillsRoot(projectPath: string): string {
  return path.join(projectPath, PROJECT_SKILLS_DIR)
}
