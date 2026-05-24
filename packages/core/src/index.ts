// Runner
export { sendMessage } from './runner.ts'
export type { SendMessageParams, SendMessageResult } from './runner.ts'

// DB — entities
export type {
  Project,
  Session,
  Message,
  Run,
  RunEvent,
  Exchange,
  StoredFileChange,
  RunStatus,
} from './db/index.ts'

// DB — connection
export { getDb } from './db/index.ts'

// DB — projects
export {
  createProject,
  getProject,
  getProjectByPath,
  listProjects,
  updateProject,
  deleteProject,
} from './db/index.ts'

// DB — sessions
export {
  createSession,
  getSession,
  listSessions,
  touchSession,
  renameSession,
  setExternalSessionId,
  deleteSession,
} from './db/index.ts'

// DB — messages
export { appendMessage, getMessage, getMessages } from './db/index.ts'

// DB — runs
export { createRun, getRun, updateRunStatus } from './db/index.ts'

// DB — events
export { appendEvent, getEvents } from './db/index.ts'

// DB — exchanges
export { getExchanges } from './db/index.ts'

// DB — file changes
export {
  saveFileChanges,
  getFileChangesForRun,
  getFileChangesForSession,
} from './db/index.ts'

// Runtimes
export type {
  RuntimeAgent,
  DetectedAgent,
  ModelOption,
  AgentEvent,
  RunOptions,
  AgentInvokeParams,
} from './runtimes/types.ts'

export { getAgent, listAgents, registerAgent } from './runtimes/registry.ts'
export { detectAgents, detectAgent } from './runtimes/detection.ts'
export { invoke, invokeAsync } from './runtimes/invocation.ts'

// Skills
export type { SkillInfo, SkillFrontmatter, SkillSource } from './skills/types.ts'
export { loadSkills, findSkill } from './skills/loader.ts'

// Projects / context
export {
  loadProjectContext,
  projectSkillsRoot,
  PROJECT_SKILLS_DIR,
} from './projects/context.ts'

// File tracker
export type { FileChange, ChangeType, Snapshot } from './files/tracker.ts'
export { takeSnapshot, computeChanges } from './files/tracker.ts'
