import type { RuntimeAgentDef, ModelOption } from '../types.ts'

function parseLineSeparatedModels(stdout: string): ModelOption[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ id: line, label: line }))
}

export const opencodeAgentDef: RuntimeAgentDef = {
  id: 'opencode',
  name: 'OpenCode',
  bin: 'opencode-cli',
  fallbackBins: ['opencode'],
  versionArgs: ['--version'],
  versionProbeTimeoutMs: 5000,
  listModels: {
    args: ['models'],
    parse: parseLineSeparatedModels,
    timeoutMs: 8000,
  },
  fallbackModels: [
    { id: 'default', label: 'Default' },
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  buildArgs: (options = {}) => {
    const args = ['run', '--format', 'json']
    if (options.model && options.model !== 'default') {
      args.push('-m', options.model)
    }
    return args
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'opencode',
  mcpInjection: 'env-content',
  installUrl: 'https://opencode.ai/docs/installation',

  /**
   * opencode emits the session ID in the first few events of a run.
   * Known shapes (across opencode versions):
   *   { type: "session",    id: "..." }
   *   { type: "session",    sessionID: "..." }
   *   { sessionID: "..." }
   *   { session: { id: "..." } }
   *   { properties: { sessionID: "..." } }
   */
  extractExternalSessionId: (raw) => {
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
  },

  /** Pass opencode's own session ID to resume native conversation history */
  resumeSessionArgs: (externalSessionId) => ['--session', externalSessionId],
}
