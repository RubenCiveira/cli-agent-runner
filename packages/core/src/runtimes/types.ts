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

/**
 * Declarative description of a CLI agent.
 * Add new agents by satisfying this interface — no other changes needed.
 */
export interface RuntimeAgentDef {
  /** Unique stable identifier */
  id: string
  /** Human-readable display name */
  name: string
  /** Primary executable name */
  bin: string
  /** Fallback executables tried in order if `bin` is not found */
  fallbackBins?: string[]
  /** Args to probe that the binary is invocable (e.g. ['--version']) */
  versionArgs: string[]
  /** Timeout for the version probe in ms */
  versionProbeTimeoutMs?: number
  /** Live model discovery via CLI */
  listModels?: {
    args: string[]
    parse: (stdout: string) => ModelOption[]
    timeoutMs: number
  }
  /** Used when live discovery fails or is unavailable */
  fallbackModels: ModelOption[]
  /** Build the CLI args array for a run invocation */
  buildArgs: (options?: RunOptions) => string[]
  /** Whether to deliver the prompt payload through stdin instead of argv */
  promptViaStdin: boolean
  /** Output format emitted by the agent */
  streamFormat: 'json-event-stream' | 'text'
  /** Key identifying which event parser to use */
  eventParser: 'opencode' | 'text'
  /** How to inject external MCP servers without touching agent config files */
  mcpInjection?: 'env-content' | 'json-file'
  /** Hard limit on bytes sent via stdin / argv */
  maxPromptBytes?: number
  /** URL where the agent can be installed */
  installUrl?: string
  /**
   * Extract the agent's native session ID from a raw event object (parsed JSON line).
   * Called on every event during the first run of a session.
   * Return the ID string when found, null otherwise.
   */
  extractExternalSessionId?: (rawEvent: unknown) => string | null
  /**
   * Build the extra CLI args needed to resume the agent's own session.
   * Appended to the result of buildArgs() when externalSessionId is present.
   */
  resumeSessionArgs?: (externalSessionId: string) => string[]
}

export interface DetectedAgent {
  id: string
  name: string
  available: boolean
  path: string | null
  version: string | null
  models: ModelOption[]
  modelsSource: 'live' | 'fallback'
}

/** A single parsed event from the agent output stream */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number }
  | { type: 'raw'; data: string }
