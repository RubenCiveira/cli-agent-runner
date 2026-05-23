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

/** Parse a single JSON line from the opencode event stream */
function parseOpencodeEvent(line: string): AgentEvent {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>

    if (obj.type === 'text' || typeof obj.text === 'string') {
      return { type: 'text', text: String(obj.text ?? '') }
    }
    if (obj.type === 'assistant' && typeof obj.message === 'object') {
      const msg = obj.message as Record<string, unknown>
      const content = msg.content
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: unknown) => (c as Record<string, unknown>)?.type === 'text')
          .map((c: unknown) => String((c as Record<string, unknown>).text ?? ''))
          .join('')
        if (textParts) return { type: 'text', text: textParts }
      }
    }
    if (obj.type === 'tool_use' && typeof obj.name === 'string') {
      return { type: 'tool_use', name: obj.name, input: obj.input }
    }
    if (obj.type === 'tool_result') {
      return {
        type: 'tool_result',
        toolUseId: String(obj.tool_use_id ?? ''),
        content: String(obj.content ?? ''),
      }
    }
    if (obj.type === 'error' || obj.error) {
      return { type: 'error', message: String(obj.message ?? obj.error ?? line) }
    }
    return { type: 'raw', data: line }
  } catch {
    return { type: 'text', text: line }
  }
}

function parseTextEvent(line: string): AgentEvent {
  return { type: 'text', text: line }
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

  const parse = def.eventParser === 'opencode' ? parseOpencodeEvent : parseTextEvent

  // Stream stdout line by line
  ;(async () => {
    const reader = activeProc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let externalSessionIdFired = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          // Try to extract the agent's native session ID before normalising the event
          if (!externalSessionIdFired && onExternalSessionId && def.extractExternalSessionId) {
            try {
              const raw = JSON.parse(trimmed)
              const sid = def.extractExternalSessionId(raw)
              if (sid) {
                externalSessionIdFired = true
                onExternalSessionId(sid)
              }
            } catch {
              // Not JSON — skip extraction attempt
            }
          }

          onEvent(parse(trimmed))
        }
      }
      if (buffer.trim()) {
        // Flush: also try session ID extraction on last chunk
        if (!externalSessionIdFired && onExternalSessionId && def.extractExternalSessionId) {
          try {
            const raw = JSON.parse(buffer.trim())
            const sid = def.extractExternalSessionId(raw)
            if (sid) {
              externalSessionIdFired = true
              onExternalSessionId(sid)
            }
          } catch {}
        }
        onEvent(parse(buffer.trim()))
      }
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
  return new Promise((resolve, reject) => {
    const events: AgentEvent[] = []
    let externalSessionId: string | null = null
    invoke({
      ...params,
      onEvent: (e) => events.push(e),
      onExternalSessionId: (id) => { externalSessionId = id },
      onDone: (code) => resolve({ events, exitCode: code, externalSessionId }),
      onError: reject,
    })
  })
}
