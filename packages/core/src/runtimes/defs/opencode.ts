import type { RuntimeAgent, AgentInvokeParams, DetectedAgent, AgentEvent, ModelOption } from '../types.ts'
import { spawnCli, runOneShot, readLines } from '../cli/index.ts'
import { splitOnQuestionForms, hasQuestionForm } from '../../prompts/ask-user.ts'

// ── Question-form expansion ───────────────────────────────────────────────────

/**
 * If `text` contains one or more <question-form> blocks, expand it into a
 * sequence of text and question_form events.  Otherwise return a single text
 * event unchanged.
 */
function expandTextEvent(text: string): AgentEvent[] {
  if (!hasQuestionForm(text)) return [{ type: 'text', text }]

  return splitOnQuestionForms(text).map((seg) =>
    seg.kind === 'form'
      ? ({ type: 'question_form', form: seg.form } satisfies AgentEvent)
      : ({ type: 'text', text: seg.content } satisfies AgentEvent),
  )
}

// ── Event parsing ─────────────────────────────────────────────────────────────

function parseEvents(line: string): AgentEvent[] {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return line.trim() ? expandTextEvent(line) : []
  }

  // { type: "message", role: "assistant", parts: [{type:"text",...}, {type:"tool-invocation",...}] }
  if (obj.type === 'message' && Array.isArray(obj.parts)) {
    if (String(obj.role ?? '') !== 'assistant') return []
    const events: AgentEvent[] = []
    for (const part of obj.parts as Record<string, unknown>[]) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text) {
        events.push(...expandTextEvent(part.text))
      } else if (part.type === 'tool-invocation') {
        const ti = part.toolInvocation as Record<string, unknown> | undefined
        if (!ti) continue
        const name = String(ti.toolName ?? '')
        const toolId = String(ti.toolCallId ?? '')
        events.push({ type: 'tool_use', name, input: ti.args })
        if (ti.state === 'result') {
          events.push({ type: 'tool_result', toolUseId: toolId, content: String(ti.result ?? '') })
        }
      }
    }
    return events
  }

  // { type: "message", role: "assistant", part: { type: "text", text: "..." } }
  if (obj.type === 'message' && typeof obj.part === 'object' && obj.part !== null && !Array.isArray(obj.parts)) {
    const part = obj.part as Record<string, unknown>
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      return expandTextEvent(part.text)
    }
  }

  // { type: "assistant", message: { content: [{type:"text",...}, {type:"tool_use",...}] } }
  if (obj.type === 'assistant' && typeof obj.message === 'object' && obj.message !== null) {
    const msg = obj.message as Record<string, unknown>
    if (Array.isArray(msg.content)) {
      const events: AgentEvent[] = []
      for (const block of msg.content as Record<string, unknown>[]) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          events.push(...expandTextEvent(block.text))
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          events.push({ type: 'tool_use', name: block.name, input: block.input })
        } else if (block.type === 'tool_result') {
          const raw = block.content
          const content = Array.isArray(raw)
            ? (raw as Record<string, unknown>[]).filter((c) => c.type === 'text').map((c) => String(c.text ?? '')).join('')
            : String(raw ?? '')
          events.push({ type: 'tool_result', toolUseId: String(block.tool_use_id ?? ''), content })
        }
      }
      return events
    }
  }

  // { type: "text", part: { type: "text", text: "..." } } — per-event text
  if (obj.type === 'text' && typeof obj.part === 'object' && obj.part !== null) {
    const part = obj.part as Record<string, unknown>
    if (typeof part.text === 'string' && part.text) {
      return expandTextEvent(part.text)
    }
  }

  // { type: "tool_use", part: { type: "tool", tool: "...", callID: "...", state: {...} } }
  if (obj.type === 'tool_use' && typeof obj.part === 'object' && obj.part !== null) {
    const part = obj.part as Record<string, unknown>
    if (part.type === 'tool') {
      const name = String(part.tool ?? '')
      const callID = String(part.callID ?? '')
      const state = (part.state ?? {}) as Record<string, unknown>
      const events: AgentEvent[] = [{ type: 'tool_use', name, input: state.input }]
      if (state.status === 'completed' && state.output !== undefined) {
        events.push({ type: 'tool_result', toolUseId: callID, content: String(state.output) })
      }
      return events
    }
  }

  // Flat types
  if (typeof obj.text === 'string' && obj.text) return expandTextEvent(obj.text)
  if (obj.type === 'tool_use' && typeof obj.name === 'string') return [{ type: 'tool_use', name: obj.name, input: obj.input }]
  if (obj.type === 'tool_result') return [{ type: 'tool_result', toolUseId: String(obj.tool_use_id ?? ''), content: String(obj.content ?? '') }]
  if (obj.type === 'error' || obj.error) return [{ type: 'error', message: String(obj.message ?? obj.error ?? line) }]

  // Skip lifecycle/metadata events
  const SKIP = new Set(['session', 'session.updated', 'done', 'start', 'complete', 'ping', 'step_start'])
  if (typeof obj.type === 'string' && SKIP.has(obj.type)) return []

  return [{ type: 'raw', data: line }]
}

// ── Session ID extraction ─────────────────────────────────────────────────────

function extractSessionId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj['id'] === 'string' && obj['type'] === 'session') return obj['id']
  if (typeof obj['sessionID'] === 'string') return obj['sessionID']
  const session = obj['session']
  if (typeof session === 'object' && session !== null) {
    const s = session as Record<string, unknown>
    if (typeof s['id'] === 'string') return s['id']
  }
  const props = obj['properties']
  if (typeof props === 'object' && props !== null) {
    const p = props as Record<string, unknown>
    if (typeof p['sessionID'] === 'string') return p['sessionID']
  }
  return null
}

// ── OpenCodeAgent ─────────────────────────────────────────────────────────────

class OpenCodeAgent implements RuntimeAgent {
  readonly id = 'opencode'
  readonly name = 'OpenCode'

  private readonly bins = ['opencode-cli', 'opencode']
  private readonly fallbackModels: ModelOption[] = [
    { id: 'default', label: 'Default' },
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ]

  // ── detect ──────────────────────────────────────────────────────────────────

  async detect(): Promise<DetectedAgent> {
    const base: Omit<DetectedAgent, 'available' | 'path' | 'version' | 'models' | 'modelsSource'> = {
      id: this.id, name: this.name,
    }

    for (const bin of this.bins) {
      const path = await this.which(bin)
      if (!path) continue

      const version = await this.probeVersion(path)
      if (!version) continue

      const { models, source } = await this.fetchModels(path)
      return { ...base, available: true, path, version, models, modelsSource: source }
    }

    return { ...base, available: false, path: null, version: null, models: this.fallbackModels, modelsSource: 'fallback' }
  }

  private async which(bin: string): Promise<string | null> {
    const result = await runOneShot('which', [bin])
    const path = result?.stdout.trim() ?? ''
    return path.length > 0 ? path : null
  }

  private async probeVersion(binPath: string): Promise<string | null> {
    const result = await runOneShot(binPath, ['--version'], { timeoutMs: 5000 })
    if (!result || result.exitCode !== 0) return null
    return result.stdout.trim().split('\n')[0] ?? null
  }

  private async fetchModels(binPath: string): Promise<{ models: ModelOption[]; source: 'live' | 'fallback' }> {
    const result = await runOneShot(binPath, ['models'], { timeoutMs: 8000 })
    if (!result || result.exitCode !== 0) return { models: this.fallbackModels, source: 'fallback' }

    const models = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id }))

    return models.length > 0
      ? { models, source: 'live' }
      : { models: this.fallbackModels, source: 'fallback' }
  }

  // ── invoke ──────────────────────────────────────────────────────────────────

  invoke(params: AgentInvokeParams): { kill: () => void } {
    const { stdinPayload, options = {}, cwd, onEvent, onExternalSessionId, onDone, onError } = params

    const args = ['run', '--format', 'json']
    if (options.model && options.model !== 'default') args.push('-m', options.model)
    if (options.externalSessionId) args.push('--session', options.externalSessionId)

    const env = { ...(Bun.env as Record<string, string>), ...(options.env ?? {}) }

    let proc: ReturnType<typeof spawnCli> | null = null
    for (const bin of this.bins) {
      try {
        proc = spawnCli(bin, args, stdinPayload, { cwd, env })
        break
      } catch { /* try next */ }
    }

    if (!proc) {
      onError(new Error('Could not launch opencode. Is it installed? https://opencode.ai/docs/installation'))
      onDone(1)
      return { kill: () => {} }
    }

    const activeProc = proc
    let sessionIdFired = false

    // Stream stdout line by line
    ;(async () => {
      try {
        for await (const line of readLines(activeProc.stdout)) {
          if (!sessionIdFired && onExternalSessionId) {
            try {
              const sid = extractSessionId(JSON.parse(line))
              if (sid) { sessionIdFired = true; onExternalSessionId(sid) }
            } catch { /* not JSON or no session ID */ }
          }
          for (const ev of parseEvents(line)) onEvent(ev)
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)))
      }
    })()

    // Collect stderr
    ;(async () => {
      const text = await new Response(activeProc.stderr).text()
      if (text.trim()) onEvent({ type: 'error', message: text.trim() })
    })()

    activeProc.exited.then((code) => onDone(code))

    return { kill: () => activeProc.kill() }
  }
}

export const opencodeAgent = new OpenCodeAgent()
