import type { SkillInfo } from '../skills/types.ts'

export interface PromptBlock {
  label: string
  content: string
}

export interface ComposeOptions {
  /** Base instructions / agent identity */
  baseInstructions?: string
  /** User-provided free-form context (e.g. project description) */
  context?: string
  /** Additional context files loaded from disk, keyed by filename */
  contextFiles?: Record<string, string>
  /** Active skill to inject */
  skill?: SkillInfo
  /** Conversation history before the current user message */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The current user message */
  userMessage: string
}

/**
 * Build a layered system prompt and the full stdin payload for the agent.
 *
 * Block order (later blocks take precedence in case of conflict):
 *  1. Base instructions
 *  2. Context
 *  3. Context files
 *  4. Active skill (with side-file preflights)
 */
export function composeSystemPrompt(options: ComposeOptions): string {
  const blocks: PromptBlock[] = []

  if (options.baseInstructions?.trim()) {
    blocks.push({
      label: 'Instructions',
      content: options.baseInstructions.trim(),
    })
  }

  if (options.context?.trim()) {
    blocks.push({
      label: 'Context',
      content: options.context.trim(),
    })
  }

  if (options.contextFiles && Object.keys(options.contextFiles).length > 0) {
    const parts = Object.entries(options.contextFiles).map(
      ([filename, content]) => `### ${filename}\n\n${content.trim()}`,
    )
    blocks.push({
      label: 'Reference files',
      content: parts.join('\n\n---\n\n'),
    })
  }

  if (options.skill) {
    blocks.push(buildSkillBlock(options.skill))
  }

  if (blocks.length === 0) return ''

  return blocks
    .map((b) => `## ${b.label}\n\n${b.content}`)
    .join('\n\n---\n\n')
}

function buildSkillBlock(skill: SkillInfo): PromptBlock {
  const sideKeys = Object.keys(skill.sideFiles)
  let preflight = ''

  if (sideKeys.length > 0) {
    const refs = sideKeys.map((k) => `- \`${k}\``).join('\n')
    preflight =
      `\n\n> **IMPORTANT**: Before writing any code or output, read these files:\n${refs}`
  }

  const sideContent =
    sideKeys.length > 0
      ? '\n\n' +
        sideKeys
          .map((k) => `### ${k}\n\n${skill.sideFiles[k].trim()}`)
          .join('\n\n---\n\n')
      : ''

  return {
    label: `Active skill — ${skill.name}`,
    content: `Follow this skill's workflow exactly.${preflight}\n\n${skill.body}${sideContent}`,
  }
}

/**
 * Build the full stdin payload that gets piped into the agent process.
 * Format: system prompt + conversation history + current user message.
 */
export function buildStdinPayload(options: ComposeOptions): string {
  const systemPrompt = composeSystemPrompt(options)
  const parts: string[] = []

  if (systemPrompt) {
    parts.push(`<system>\n${systemPrompt}\n</system>`)
  }

  if (options.history && options.history.length > 0) {
    const historyText = options.history
      .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
      .join('\n\n')
    parts.push(historyText)
  }

  parts.push(options.userMessage)

  return parts.join('\n\n')
}
