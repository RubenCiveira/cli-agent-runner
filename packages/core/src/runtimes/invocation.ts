import type { RuntimeAgentDef, AgentEvent, RunOptions } from './types.ts'
import { getAgentDef } from './registry.ts'

export interface InvokeParams {
  agentId: string
  stdinPayload: string
  options?: RunOptions
  cwd?: string
  onEvent: (event: AgentEvent) => void
  /**
   * Called the first time the agent's native session ID is detected in the stream.
   * Only fired once per invocation. Used to persist the ID for future resumes.
   */
  onExternalSessionId?: (id: string) => void
  onDone: (exitCode: number) => void
  onError: (err: Error) => void
}

/**
 * Parse one JSON line from the opencode stream into zero or more events.
 * Returns an array because a single opencode message can contain multiple
 * content blocks (text + tool calls interleaved).
 */
function parseOpencodeEvents(line: string): AgentEvent[] {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    // Plain text line (rare, only in non-JSON modes)
    return line.trim() ? [{ type: 'text', text: line }] : []
  }

  // ── Newer opencode format ──────────────────────────────────────────────────
  // { type: "message", role: "assistant", parts: [{type:"text",text:"..."}, {type:"tool-invocation",...}] }
  if (obj.type === 'message' && Array.isArray(obj.parts)) {
    const role = String(obj.role ?? '')
    if (role !== 'assistant') return []   // skip user echo & system echoes
    const events: AgentEvent[] = []
    for (const part of obj.parts as Record<string, unknown>[]) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text) {
        events.push({ type: 'text', text: part.text })
      } else if (part.type === 'tool-invocation') {
        const ti = part.toolInvocation as Record<string, unknown> | undefined
        if (!ti) continue
        const name = String(ti.toolName ?? '')
        const toolId = String(ti.toolCallId ?? '')
        if (ti.state === 'result') {
          events.push({ type: 'tool_use', name, input: ti.args })
          events.push({ type: 'tool_result', toolUseId: toolId, content: String(ti.result ?? '') })
        } else {
          events.push({ type: 'tool_use', name, input: ti.args })
        }
      }
    }
    return events
  }

  // ── Older opencode format ──────────────────────────────────────────────────
  // { type: "assistant", message: { content: [{type:"text",text:""}, {type:"tool_use",...}] } }
  if (obj.type === 'assistant' && typeof obj.message === 'object' && obj.message !== null) {
    const msg = obj.message as Record<string, unknown>
    const content = msg.content
    if (Array.isArray(content)) {
      const events: AgentEvent[] = []
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          events.push({ type: 'text', text: block.text })
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          events.push({ type: 'tool_use', name: block.name, input: block.input })
        } else if (block.type === 'tool_result') {
          const raw = block.content
          const content = Array.isArray(raw)
            ? (raw as Record<string, unknown>[]).filter(c => c.type === 'text').map(c => String(c.text ?? '')).join('')
            : String(raw ?? '')
          events.push({ type: 'tool_result', toolUseId: String(block.tool_use_id ?? ''), content })
        }
      }
      return events
    }
  }

  // ── New opencode per-event format ─────────────────────────────────────────
  // { type: "tool_use", part: { type: "tool", tool: "grep", callID: "...", state: { status: "completed", input: {...}, output: "..." } } }
  if (obj.type === 'tool_use' && typeof obj.part === 'object' && obj.part !== null) {
    const part = obj.part as Record<string, unknown>
    if (part.type === 'tool') {
      const name = String(part.tool ?? '')
      const callID = String(part.callID ?? '')
      const state = (part.state ?? {}) as Record<string, unknown>
      const events: AgentEvent[] = [{ type: 'tool_use', name, input: state.input }]
      if (state.status === 'completed' && state.output !== undefined) {
        events.push({ type: 'tool_result', toolUseId: callID, content: String(state.output ?? '') })
      }
      return events
    }
  }

  // New opencode single-part message event (part object, not parts array)
  // { type: "message", role: "assistant", part: { type: "text", text: "..." } }
  if (obj.type === 'message' && typeof obj.part === 'object' && obj.part !== null && !Array.isArray(obj.parts)) {
    const part = obj.part as Record<string, unknown>
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      return [{ type: 'text', text: part.text }]
    }
  }

  // New opencode text event with part wrapping — this is the actual final assistant text
  // { type: "text", part: { type: "text", text: "...", time: {...} } }
  if (obj.type === 'text' && typeof obj.part === 'object' && obj.part !== null) {
    const part = obj.part as Record<string, unknown>
    if (typeof part.text === 'string' && part.text) {
      return [{ type: 'text', text: part.text }]
    }
  }

  // ── Flat event types ───────────────────────────────────────────────────────
  if (typeof obj.text === 'string' && obj.text) return [{ type: 'text', text: obj.text }]
  if (obj.type === 'tool_use' && typeof obj.name === 'string') return [{ type: 'tool_use', name: obj.name, input: obj.input }]
  if (obj.type === 'tool_result') return [{ type: 'tool_result', toolUseId: String(obj.tool_use_id ?? ''), content: String(obj.content ?? '') }]
  if (obj.type === 'error' || obj.error) return [{ type: 'error', message: String(obj.message ?? obj.error ?? line) }]

  // ── Skip known metadata-only events ───────────────────────────────────────
  const SKIP = new Set(['session', 'session.updated', 'done', 'start', 'complete', 'ping', 'step_start'])
  if (typeof obj.type === 'string' && SKIP.has(obj.type)) return []

  // step_finish carries token/cost stats — emit as raw so the UI can display them
  // (keeping as raw avoids adding a new AgentEvent type to the core types)

  // ── Unknown — keep raw so the UI can display it ────────────────────────────
  return [{ type: 'raw', data: line }]
}

function parseTextEvents(line: string): AgentEvent[] {
  return line.trim() ? [{ type: 'text', text: line }] : []
}

export function invoke(params: InvokeParams): { kill: () => void } {
  const { agentId, stdinPayload, options = {}, cwd, onEvent, onExternalSessionId, onDone, onError } =
    params

  const def = getAgentDef(agentId)
  if (!def) {
    onError(new Error(`Unknown agent: ${agentId}`))
    onDone(1)
    return { kill: () => {} }
  }

  // Build args: base args + resume args if we have the agent's native session ID
  let args = def.buildArgs(options)
  if (options.externalSessionId && def.resumeSessionArgs) {
    args = [...args, ...def.resumeSessionArgs(options.externalSessionId)]
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(options.env ?? {}),
  }

  type SpawnedProc = ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'pipe'>>
  let proc: SpawnedProc | null = null

  const spawnOptions = {
    cwd,
    env,
    stdin: 'pipe' as const,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  }

  try {
    proc = Bun.spawn([def.bin, ...args], spawnOptions)
  } catch {
    for (const fallback of def.fallbackBins ?? []) {
      try {
        proc = Bun.spawn([fallback, ...args], spawnOptions)
        break
      } catch {}
    }
    if (!proc) {
      onError(new Error(`Could not launch agent "${agentId}". Is it installed?`))
      onDone(1)
      return { kill: () => {} }
    }
  }

  const activeProc = proc

  if (def.promptViaStdin) {
    activeProc.stdin.write(stdinPayload)
    activeProc.stdin.end()
  }

  const parseEvents = def.eventParser === 'opencode' ? parseOpencodeEvents : parseTextEvents

  const emitLine = (trimmed: string, externalSessionIdFired: { value: boolean }) => {
    // Try to extract the agent's native session ID before normalising the event
    if (!externalSessionIdFired.value && onExternalSessionId && def.extractExternalSessionId) {
      try {
        const sid = def.extractExternalSessionId(JSON.parse(trimmed))
        if (sid) { externalSessionIdFired.value = true; onExternalSessionId(sid) }
      } catch {}
    }
    for (const ev of parseEvents(trimmed)) onEvent(ev)
  }

  // Stream stdout line by line
  ;(async () => {
    const reader = activeProc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const fired = { value: false }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) emitLine(trimmed, fired)
        }
      }
      if (buffer.trim()) emitLine(buffer.trim(), fired)
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  // Collect stderr for error reporting
  ;(async () => {
    const text = await new Response(activeProc.stderr).text()
    if (text.trim()) onEvent({ type: 'error', message: text.trim() })
  })()

  activeProc.exited.then((code) => onDone(code ?? 0))

  return { kill: () => activeProc.kill() }
}

/** Promise-based wrapper — resolves when the run completes */
export async function invokeAsync(
  params: Omit<InvokeParams, 'onEvent' | 'onDone' | 'onError'>,
): Promise<{ events: AgentEvent[]; exitCode: number; externalSessionId: string | null }> {
  return new Promise((resolve, _reject) => {
    const events: AgentEvent[] = []
    let externalSessionId: string | null = null
    invoke({
      ...params,
      onEvent: (e) => events.push(e),
      onExternalSessionId: (id) => { externalSessionId = id },
      onDone: (code) => resolve({ events, exitCode: code, externalSessionId }),
      onError: (err) => resolve({ events: [...events, { type: 'error', message: err.message }], exitCode: 1, externalSessionId }),
    })
  })
}
