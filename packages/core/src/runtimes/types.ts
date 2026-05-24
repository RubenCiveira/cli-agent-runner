export type { QuestionForm, FormQuestion, QuestionOption, QuestionType, FormAnswers } from '../prompts/ask-user.ts'

export interface ModelOption {
  id: string
  label: string
}

export interface McpServerConfig {
  /** Unique identifier used as the MCP server key */
  id: string
  /** stdio command + args, e.g. ["npx", "-y", "@modelcontextprotocol/server-github"] */
  command: [string, ...string[]]
  /** Environment variables injected into the MCP server process */
  env?: Record<string, string>
}

export interface AgentFileConfig {
  /** Display name (used as a header in the injected prompt) */
  name: string
  /** Full markdown/text content of the agent definition */
  content: string
}

export interface SkillConfig {
  /** Display name */
  name: string
  /** Full markdown/text content of the skill */
  content: string
}

export interface ContextFileConfig {
  /** Filename shown as a header (e.g. "Design.md") */
  name: string
  /** Full text content */
  content: string
}

export interface WorkspaceResources {
  /** MCP servers to inject into the runner */
  mcps?: McpServerConfig[]
  /** Agent definition files to prepend to the prompt */
  agents?: AgentFileConfig[]
  /** Skill documents to prepend to the prompt */
  skills?: SkillConfig[]
  /** Arbitrary context files (e.g. Design.md) to prepend to the prompt */
  contextFiles?: ContextFileConfig[]
}

export interface RunOptions {
  model?: string
  env?: Record<string, string>
  /** Agent's native session ID — passed back when resuming an existing session */
  externalSessionId?: string
  /** Workspace-level resources: MCPs, agents, skills, context files */
  resources?: WorkspaceResources
}

import type { QuestionForm } from '../prompts/ask-user.ts'

/** A single parsed event from the agent output stream */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string }
  | { type: 'question_form'; form: QuestionForm }
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
