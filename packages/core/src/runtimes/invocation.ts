import type { AgentEvent, RunOptions } from './types.ts'
import { getAgent } from './registry.ts'

export interface InvokeParams {
  agentId: string
  stdinPayload: string
  options?: RunOptions
  cwd?: string
  onEvent: (event: AgentEvent) => void
  onExternalSessionId?: (id: string) => void
  onDone: (exitCode: number) => void
  onError: (err: Error) => void
}

export function invoke(params: InvokeParams): { kill: () => void } {
  const { agentId, ...rest } = params

  const agent = getAgent(agentId)
  if (!agent) {
    params.onError(new Error(`Unknown agent: ${agentId}`))
    params.onDone(1)
    return { kill: () => {} }
  }

  return agent.invoke(rest)
}

export async function invokeAsync(
  params: Omit<InvokeParams, 'onEvent' | 'onDone' | 'onError'>,
): Promise<{ events: AgentEvent[]; exitCode: number; externalSessionId: string | null }> {
  return new Promise((resolve) => {
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
