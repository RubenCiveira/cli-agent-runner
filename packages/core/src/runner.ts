import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

import type { AgentEvent } from './runtimes/types.ts'
import { invoke } from './runtimes/invocation.ts'
import { loadSkills, findSkill } from './skills/loader.ts'
import { buildStdinPayload } from './prompts/composer.ts'
import { loadProjectContext, projectSkillsRoot } from './projects/context.ts'
import { takeSnapshot, computeChanges } from './files/tracker.ts'
import {
  getDb,
  createRun,
  createSession,
  getSession,
  getProject,
  appendEvent,
  appendMessage,
  updateRunStatus,
  getMessages,
  touchSession,
  setExternalSessionId,
  saveFileChanges,
} from './db/index.ts'

export interface SendMessageParams {
  /** Existing session ID to continue, or omit to create a new one */
  sessionId?: string
  /** Required when creating a new session */
  newSession?: {
    projectId?: string
    agentId?: string
    skillId?: string
    model?: string
  }
  /** The user message content */
  message: string
  /** Inline extra context (appended to project context) */
  context?: string
  /** Path to an additional context file */
  contextFile?: string
  /** Called for each streamed agent event */
  onEvent?: (event: AgentEvent) => void
}

export interface SendMessageResult {
  sessionId: string
  runId: string
  exitCode: number
  events: AgentEvent[]
  /** Agent's native session ID — present after first run in a new session */
  externalSessionId: string | null
}

const GLOBAL_SKILLS_ROOTS = [
  path.join(process.cwd(), 'user-skills'),
  path.join(process.cwd(), 'skills'),
]

const DEFAULT_BASE_INSTRUCTIONS = `You are a helpful AI assistant.
Be concise and precise. When writing code, prefer readability and correctness.`

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  const db = getDb()

  // ── Resolve or create session ──────────────────────────────────────────────
  let session = params.sessionId ? getSession(db, params.sessionId) : null

  if (params.sessionId && !session) {
    throw new Error(`Session not found: "${params.sessionId}"`)
  }

  if (!session) {
    const ns = params.newSession ?? {}
    const agentId = ns.agentId ?? 'opencode'
    const autoName = params.message.slice(0, 60).trim() + (params.message.length > 60 ? '…' : '')
    session = createSession(db, {
      id: crypto.randomUUID(),
      projectId: ns.projectId,
      name: autoName,
      agentId,
      skillId: ns.skillId,
      model: ns.model,
    })
  }

  // ── Resolve project context ────────────────────────────────────────────────
  let projectPath: string | undefined
  let projectContext = ''

  if (session.project_id) {
    const project = getProject(db, session.project_id)
    if (project) {
      projectPath = project.path
      const ctx = await loadProjectContext(project.path)
      projectContext = ctx.content
    }
  }

  // ── Load skills ────────────────────────────────────────────────────────────
  const skillsRoots = projectPath
    ? [projectSkillsRoot(projectPath), ...GLOBAL_SKILLS_ROOTS]
    : GLOBAL_SKILLS_ROOTS

  const skills = await loadSkills(skillsRoots)
  const skill = session.skill_id ? findSkill(skills, session.skill_id) : undefined

  // ── Load optional extra context file ──────────────────────────────────────
  let contextFiles: Record<string, string> | undefined
  if (params.contextFile) {
    const absPath = path.resolve(params.contextFile)
    if (!existsSync(absPath)) throw new Error(`Context file not found: ${absPath}`)
    contextFiles = { [path.basename(absPath)]: await readFile(absPath, 'utf8') }
  }

  // ── Merge context ──────────────────────────────────────────────────────────
  const contextParts = [projectContext, params.context ?? ''].filter(Boolean)
  const mergedContext = contextParts.join('\n\n') || undefined

  // ── Decide whether to inject history in stdin ──────────────────────────────
  // When resuming a session that has an agent-native session ID, opencode loads
  // its own conversation history — we must NOT duplicate it via stdin.
  const isResumingNativeSession = session.external_session_id !== null
  const history = isResumingNativeSession
    ? [] // opencode manages its own history
    : getMessages(db, session.id).map((m) => ({ role: m.role, content: m.content }))

  // ── Compose stdin payload ──────────────────────────────────────────────────
  const stdinPayload = buildStdinPayload({
    baseInstructions: DEFAULT_BASE_INSTRUCTIONS,
    context: mergedContext,
    contextFiles,
    skill,
    history,
    userMessage: params.message,
  })

  // ── Snapshot project files before invoking the agent ──────────────────────
  const snapshot = projectPath ? await takeSnapshot(projectPath) : null

  // ── Create run first so user message can reference it ─────────────────────
  const runId = crypto.randomUUID()
  createRun(db, { id: runId, sessionId: session.id })
  updateRunStatus(db, runId, 'running')
  appendMessage(db, session.id, 'user', params.message, runId)

  // ── Invoke agent ───────────────────────────────────────────────────────────
  const events: AgentEvent[] = []
  const assistantParts: string[] = []
  let capturedExternalSessionId: string | null = session.external_session_id

  return new Promise((resolve) => {
    invoke({
      agentId: session!.agent_id,
      stdinPayload,
      options: {
        model: session!.model ?? undefined,
        // Pass agent's native session ID so it can resume its own conversation
        externalSessionId: session!.external_session_id ?? undefined,
      },
      cwd: projectPath,
      onExternalSessionId: (id) => {
        // First run in this session — persist the agent's native session ID
        capturedExternalSessionId = id
        setExternalSessionId(db, session!.id, id)
      },
      onEvent: (event) => {
        events.push(event)
        appendEvent(db, runId, event)
        if (event.type === 'text') assistantParts.push(event.text)
        params.onEvent?.(event)
      },
      onDone: (exitCode) => {
        const assistantText = assistantParts.join('')
        if (assistantText) appendMessage(db, session!.id, 'assistant', assistantText, runId)
        touchSession(db, session!.id)
        updateRunStatus(db, runId, exitCode === 0 ? 'completed' : 'failed', { exitCode })

        // Compute and persist file changes after the agent completes
        if (snapshot && projectPath) {
          computeChanges(projectPath, snapshot).then((changes) => {
            if (changes.length > 0) saveFileChanges(db, runId, session!.id, changes)
          }).catch(() => {}) // non-fatal — don't fail the run
        }

        resolve({
          sessionId: session!.id,
          runId,
          exitCode,
          events,
          externalSessionId: capturedExternalSessionId,
        })
      },
      onError: (err) => {
        updateRunStatus(db, runId, 'failed', { error: err.message })
        events.push({ type: 'error', message: err.message })

        if (snapshot && projectPath) {
          computeChanges(projectPath, snapshot).then((changes) => {
            if (changes.length > 0) saveFileChanges(db, runId, session!.id, changes)
          }).catch(() => {})
        }

        resolve({
          sessionId: session!.id,
          runId,
          exitCode: 1,
          events,
          externalSessionId: capturedExternalSessionId,
        })
      },
    })
  })
}
