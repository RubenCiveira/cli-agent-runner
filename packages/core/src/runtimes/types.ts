export interface ModelOption {
  id: string
  label: string
}

export interface RunOptions {
  model?: string
  env?: Record<string, string>
  /** Agent's native session ID — passed back when resuming an existing session */
  externalSessionId?: string
}

/** A single parsed event from the agent output stream */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number }
  | { type: 'raw'; data: string }

export interface DetectedAgent {
  id: string
  name: string
  available: boolean
  path: string | null
  version: string | null
  models: ModelOption[]
  modelsSource: 'live' | 'fallback'
}

export interface AgentInvokeParams {
  stdinPayload: string
  options?: RunOptions
  cwd?: string
  onEvent: (event: AgentEvent) => void
  /** Called once with the agent's native session ID the first time it appears. */
  onExternalSessionId?: (id: string) => void
  onDone: (exitCode: number) => void
  onError: (err: Error) => void
}

/**
 * A runtime agent implementation.
 * Each agent is responsible for its own binary detection, invocation, and
 * event parsing — the runner only interacts with this interface.
 */
export interface RuntimeAgent {
  readonly id: string
  readonly name: string
  /** Probe whether the agent is installed and return capability info. */
  detect(): Promise<DetectedAgent>
  /** Invoke the agent and stream events back via callbacks. */
  invoke(params: AgentInvokeParams): { kill: () => void }
}
