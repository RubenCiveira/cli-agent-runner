export type SkillSource = 'built-in' | 'user'

export interface SkillInfo {
  /** Stable identifier, defaults to directory name */
  id: string
  name: string
  description: string
  /** Tags for filtering / display */
  tags: string[]
  source: SkillSource
  /** Absolute path to the SKILL.md file */
  filePath: string
  /** Absolute path to the skill directory */
  dir: string
  /** Raw markdown body (content after frontmatter) */
  body: string
  /** Optional additional context files loaded alongside the skill */
  sideFiles: Record<string, string>
}

export interface SkillFrontmatter {
  name?: string
  description?: string
  tags?: string | string[]
}
