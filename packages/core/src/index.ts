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

// DB — resource entities
export type {
  Agent,
  Skill,
  McpServer,
  ContextFile,
  ProjectMcp,
  ResolvedProjectMcp,
} from './db/index.ts'

// DB — agents
export { upsertAgent, getAgent as getAgentRecord, listAgents as listAgentRecords, deleteAgent } from './db/index.ts'

// DB — skills
export { upsertSkill, getSkill, listSkills, deleteSkill } from './db/index.ts'

// DB — mcp servers
export { upsertMcpServer, getMcpServer, listMcpServers, deleteMcpServer } from './db/index.ts'

// DB — context files
export { upsertContextFile, getContextFile, listContextFiles, deleteContextFile } from './db/index.ts'

// DB — project resource assignments
export {
  setProjectAgents,
  getProjectAgents,
  setProjectSkills,
  getProjectSkills,
  assignProjectContextFile,
  unassignProjectContextFile,
  setProjectContextFiles,
  getProjectContextFiles,
  setProjectMcp,
  removeProjectMcp,
  getProjectMcps,
} from './db/index.ts'

// DB — seed
export { seedFromDirectory } from './db/seed.ts'
export type { SeedResult } from './db/seed.ts'

// Runtimes
export type {
  RuntimeAgent,
  DetectedAgent,
  ModelOption,
  AgentEvent,
  RunOptions,
  AgentInvokeParams,
  QuestionForm,
  FormQuestion,
  QuestionOption,
  QuestionType,
  FormAnswers,
} from './runtimes/types.ts'

// Question-form utilities
export {
  ASK_USER_PROMPT,
  splitOnQuestionForms,
  formatFormAnswers,
  hasQuestionForm,
} from './prompts/ask-user.ts'
export type { FormSegment } from './prompts/ask-user.ts'

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
