import { Database } from 'bun:sqlite'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import type { AgentEvent } from '../runtimes/types.ts'
import type { FileChange } from '../files/tracker.ts'

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

// ── Entity types ──────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  path: string
  created_at: number
  updated_at: number
}

export interface Session {
  id: string
  project_id: string | null
  name: string
  agent_id: string
  skill_id: string | null
  model: string | null
  /** The agent's own native session ID — set after the first run completes */
  external_session_id: string | null
  created_at: number
  updated_at: number
}

export interface Message {
  id: string
  session_id: string
  run_id: string | null
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export interface Exchange {
  runId: string
  runStatus: RunStatus
  userMessage: Message | null
  assistantMessage: Message | null
  events: RunEvent[]
}

export interface Run {
  id: string
  session_id: string
  status: RunStatus
  created_at: number
  updated_at: number
  exit_code: number | null
  error: string | null
}

export interface RunEvent {
  id: number
  run_id: string
  type: string
  data: string
  created_at: number
}

export interface StoredFileChange {
  id: number
  run_id: string
  session_id: string
  path: string
  change_type: 'added' | 'modified' | 'deleted'
  diff: string | null
  /** 0 = inside project root (path is relative); 1 = outside project root (path is absolute) */
  external: number
  created_at: number
}

// ── Resource entity types ─────────────────────────────────────────────────────

export interface Agent {
  id: string
  name: string
  content: string
  created_at: number
  updated_at: number
}

export interface Skill {
  id: string
  name: string
  content: string
  created_at: number
  updated_at: number
}

/** command and env are stored as JSON strings in SQLite */
export interface McpServer {
  id: string
  name: string
  /** JSON-serialised string[], e.g. '["npx","-y","@mcp/server"]' */
  command: string
  /** JSON-serialised Record<string,string> | null — non-secret defaults */
  env: string | null
  created_at: number
  updated_at: number
}

export interface ContextFile {
  id: string
  /** Display filename, e.g. "Design.md" */
  name: string
  content: string
  created_at: number
  updated_at: number
}

/** Per-project MCP assignment with credential overrides */
export interface ProjectMcp {
  project_id: string
  mcp_id: string
  /** JSON-serialised Record<string,string> | null — project-specific env overrides (e.g. API keys) */
  env_override: string | null
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  skill_id            TEXT,
  model               TEXT,
  external_session_id TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id     TEXT REFERENCES runs(id) ON DELETE SET NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  exit_code  INTEGER,
  error      TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  change_type TEXT NOT NULL,
  diff        TEXT,
  external    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_project    ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_session    ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_runs_session        ON runs(session_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run      ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_run    ON file_changes(run_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id);

CREATE TABLE IF NOT EXISTS agents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  command    TEXT NOT NULL,
  env        TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS context_files (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_agents (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, agent_id)
);

CREATE TABLE IF NOT EXISTS project_skills (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE IF NOT EXISTS project_mcps (
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mcp_id       TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  env_override TEXT,
  PRIMARY KEY (project_id, mcp_id)
);

CREATE TABLE IF NOT EXISTS project_context_files (
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context_file_id TEXT NOT NULL REFERENCES context_files(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, context_file_id)
);
`

let _db: Database | null = null

export function getDb(dbPath?: string): Database {
  if (_db) return _db
  const resolved = dbPath ?? path.join(process.cwd(), '.runner', 'data.sqlite')
  mkdirSync(path.dirname(resolved), { recursive: true })
  _db = new Database(resolved)
  _db.exec('PRAGMA journal_mode = WAL;')
  _db.exec('PRAGMA foreign_keys = ON;')
  _db.exec(SCHEMA)
  runMigrations(_db)
  return _db
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(db: Database): void {
  try { db.exec('ALTER TABLE sessions ADD COLUMN external_session_id TEXT') } catch {}
  try { db.exec('ALTER TABLE messages ADD COLUMN run_id TEXT REFERENCES runs(id) ON DELETE SET NULL') } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS file_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      path        TEXT NOT NULL,
      change_type TEXT NOT NULL,
      diff        TEXT,
      external    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    )`)
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_run ON file_changes(run_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id)')
  } catch {}
  try { db.exec('ALTER TABLE file_changes ADD COLUMN external INTEGER NOT NULL DEFAULT 0') } catch {}
  // Resource tables (added later — safe to re-run)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, command TEXT NOT NULL, env TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE IF NOT EXISTS context_files (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
    db.exec(`CREATE TABLE IF NOT EXISTS project_agents (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, PRIMARY KEY (project_id, agent_id))`)
    db.exec(`CREATE TABLE IF NOT EXISTS project_skills (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (project_id, skill_id))`)
    db.exec(`CREATE TABLE IF NOT EXISTS project_mcps (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, mcp_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE, env_override TEXT, PRIMARY KEY (project_id, mcp_id))`)
    db.exec(`CREATE TABLE IF NOT EXISTS project_context_files (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, context_file_id TEXT NOT NULL REFERENCES context_files(id) ON DELETE CASCADE, PRIMARY KEY (project_id, context_file_id))`)
  } catch {}
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function createProject(
  db: Database,
  params: { id: string; name: string; path: string },
): Project {
  const now = Date.now()
  db.run(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [params.id, params.name, params.path, now, now],
  )
  return getProject(db, params.id)!
}

export function getProject(db: Database, id: string): Project | null {
  return db.query<Project, string>('SELECT * FROM projects WHERE id = ?').get(id)
}

export function getProjectByPath(db: Database, absPath: string): Project | null {
  return db.query<Project, string>('SELECT * FROM projects WHERE path = ?').get(absPath)
}

export function listProjects(db: Database): Project[] {
  return db.query<Project, []>('SELECT * FROM projects ORDER BY updated_at DESC').all()
}

export function updateProject(
  db: Database,
  id: string,
  patch: Partial<Pick<Project, 'name'>>,
): void {
  db.run(`UPDATE projects SET name = COALESCE(?, name), updated_at = ? WHERE id = ?`, [
    patch.name ?? null,
    Date.now(),
    id,
  ])
}

export function deleteProject(db: Database, id: string): void {
  db.run('DELETE FROM projects WHERE id = ?', [id])
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function createSession(
  db: Database,
  params: {
    id: string
    projectId?: string
    name: string
    agentId: string
    skillId?: string
    model?: string
  },
): Session {
  const now = Date.now()
  db.run(
    `INSERT INTO sessions (id, project_id, name, agent_id, skill_id, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.projectId ?? null,
      params.name,
      params.agentId,
      params.skillId ?? null,
      params.model ?? null,
      now,
      now,
    ],
  )
  return getSession(db, params.id)!
}

export function getSession(db: Database, id: string): Session | null {
  return db.query<Session, string>('SELECT * FROM sessions WHERE id = ?').get(id)
}

export function listSessions(db: Database, projectId?: string): Session[] {
  if (projectId) {
    return db
      .query<Session, string>(
        'SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC',
      )
      .all(projectId)
  }
  return db
    .query<Session, []>('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all()
}

export function touchSession(db: Database, id: string): void {
  db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [Date.now(), id])
}

export function renameSession(db: Database, id: string, name: string): void {
  db.run('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    Date.now(),
    id,
  ])
}

export function setExternalSessionId(
  db: Database,
  id: string,
  externalSessionId: string,
): void {
  db.run(
    'UPDATE sessions SET external_session_id = ?, updated_at = ? WHERE id = ?',
    [externalSessionId, Date.now(), id],
  )
}

export function deleteSession(db: Database, id: string): void {
  db.run('DELETE FROM sessions WHERE id = ?', [id])
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function appendMessage(
  db: Database,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  runId?: string,
): Message {
  const id = crypto.randomUUID()
  db.run(
    `INSERT INTO messages (id, session_id, run_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, sessionId, runId ?? null, role, content, Date.now()],
  )
  touchSession(db, sessionId)
  return getMessage(db, id)!
}

export function getMessage(db: Database, id: string): Message | null {
  return db.query<Message, string>('SELECT * FROM messages WHERE id = ?').get(id)
}

export function getMessages(db: Database, sessionId: string): Message[] {
  return db
    .query<Message, string>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId)
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export function createRun(
  db: Database,
  params: { id: string; sessionId: string },
): Run {
  const now = Date.now()
  db.run(
    `INSERT INTO runs (id, session_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)`,
    [params.id, params.sessionId, now, now],
  )
  return getRun(db, params.id)!
}

export function getRun(db: Database, id: string): Run | null {
  return db.query<Run, string>('SELECT * FROM runs WHERE id = ?').get(id)
}

export function updateRunStatus(
  db: Database,
  id: string,
  status: RunStatus,
  extra: { exitCode?: number; error?: string } = {},
): void {
  db.run(
    `UPDATE runs SET status = ?, exit_code = ?, error = ?, updated_at = ? WHERE id = ?`,
    [status, extra.exitCode ?? null, extra.error ?? null, Date.now(), id],
  )
}

// ── Run events ────────────────────────────────────────────────────────────────

export function appendEvent(db: Database, runId: string, event: AgentEvent): void {
  db.run(
    `INSERT INTO run_events (run_id, type, data, created_at) VALUES (?, ?, ?, ?)`,
    [runId, event.type, JSON.stringify(event), Date.now()],
  )
}

export function getEvents(db: Database, runId: string): RunEvent[] {
  return db
    .query<RunEvent, string>(
      'SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC',
    )
    .all(runId)
}

// ── Exchanges ─────────────────────────────────────────────────────────────────

export function getExchanges(db: Database, sessionId: string): Exchange[] {
  const runs = db
    .query<Run, string>('SELECT * FROM runs WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId)

  if (runs.length === 0) return []

  const allMsgs = db
    .query<Message, string>('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId)

  // Unlinked messages (run_id = NULL) kept for legacy sequential fallback
  const unlinked = allMsgs.filter((m) => m.run_id === null)
  let legacyIdx = 0

  return runs.map((run) => {
    const events = db
      .query<RunEvent, string>('SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC')
      .all(run.id)

    // Per-run: prefer messages linked by run_id (current schema)
    const linked = allMsgs.filter((m) => m.run_id === run.id)
    if (linked.length > 0) {
      return {
        runId: run.id,
        runStatus: run.status,
        userMessage: linked.find((m) => m.role === 'user') ?? null,
        assistantMessage: linked.find((m) => m.role === 'assistant') ?? null,
        events,
      }
    }

    // Legacy fallback: sequential pair from unlinked messages
    const userMessage = unlinked[legacyIdx * 2]?.role === 'user' ? unlinked[legacyIdx * 2] : null
    const assistantMessage = unlinked[legacyIdx * 2 + 1]?.role === 'assistant' ? unlinked[legacyIdx * 2 + 1] : null
    legacyIdx++
    return { runId: run.id, runStatus: run.status, userMessage, assistantMessage, events }
  })
}

// ── File changes ──────────────────────────────────────────────────────────────

export function saveFileChanges(
  db: Database,
  runId: string,
  sessionId: string,
  changes: FileChange[],
): void {
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO file_changes (run_id, session_id, path, change_type, diff, external, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertAll = db.transaction((rows: FileChange[]) => {
    for (const c of rows) {
      insert.run(runId, sessionId, c.path, c.type, c.diff ?? null, c.external ? 1 : 0, now)
    }
  })
  insertAll(changes)
}

/** All file changes for a specific run */
export function getFileChangesForRun(
  db: Database,
  runId: string,
): StoredFileChange[] {
  return db
    .query<StoredFileChange, string>(
      'SELECT * FROM file_changes WHERE run_id = ? ORDER BY path ASC',
    )
    .all(runId)
}

/** All file changes across all runs in a session */
export function getFileChangesForSession(
  db: Database,
  sessionId: string,
): StoredFileChange[] {
  return db
    .query<StoredFileChange, string>(
      'SELECT * FROM file_changes WHERE session_id = ? ORDER BY created_at ASC, path ASC',
    )
    .all(sessionId)
}

// ── Agents ────────────────────────────────────────────────────────────────────

export function upsertAgent(
  db: Database,
  params: { id: string; name: string; content: string },
): Agent {
  const now = Date.now()
  db.run(
    `INSERT INTO agents (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, updated_at = excluded.updated_at`,
    [params.id, params.name, params.content, now, now],
  )
  return db.query<Agent, string>('SELECT * FROM agents WHERE id = ?').get(params.id)!
}

export function getAgent(db: Database, id: string): Agent | null {
  return db.query<Agent, string>('SELECT * FROM agents WHERE id = ?').get(id)
}

export function listAgents(db: Database): Agent[] {
  return db.query<Agent, []>('SELECT * FROM agents ORDER BY name ASC').all()
}

export function deleteAgent(db: Database, id: string): void {
  db.run('DELETE FROM agents WHERE id = ?', [id])
}

// ── Skills ────────────────────────────────────────────────────────────────────

export function upsertSkill(
  db: Database,
  params: { id: string; name: string; content: string },
): Skill {
  const now = Date.now()
  db.run(
    `INSERT INTO skills (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, updated_at = excluded.updated_at`,
    [params.id, params.name, params.content, now, now],
  )
  return db.query<Skill, string>('SELECT * FROM skills WHERE id = ?').get(params.id)!
}

export function getSkill(db: Database, id: string): Skill | null {
  return db.query<Skill, string>('SELECT * FROM skills WHERE id = ?').get(id)
}

export function listSkills(db: Database): Skill[] {
  return db.query<Skill, []>('SELECT * FROM skills ORDER BY name ASC').all()
}

export function deleteSkill(db: Database, id: string): void {
  db.run('DELETE FROM skills WHERE id = ?', [id])
}

// ── MCP servers ───────────────────────────────────────────────────────────────

export function upsertMcpServer(
  db: Database,
  params: { id: string; name: string; command: string[]; env?: Record<string, string> },
): McpServer {
  const now = Date.now()
  const command = JSON.stringify(params.command)
  const env = params.env && Object.keys(params.env).length > 0 ? JSON.stringify(params.env) : null
  db.run(
    `INSERT INTO mcp_servers (id, name, command, env, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, command = excluded.command, env = excluded.env, updated_at = excluded.updated_at`,
    [params.id, params.name, command, env, now, now],
  )
  return db.query<McpServer, string>('SELECT * FROM mcp_servers WHERE id = ?').get(params.id)!
}

export function getMcpServer(db: Database, id: string): McpServer | null {
  return db.query<McpServer, string>('SELECT * FROM mcp_servers WHERE id = ?').get(id)
}

export function listMcpServers(db: Database): McpServer[] {
  return db.query<McpServer, []>('SELECT * FROM mcp_servers ORDER BY name ASC').all()
}

export function deleteMcpServer(db: Database, id: string): void {
  db.run('DELETE FROM mcp_servers WHERE id = ?', [id])
}

// ── Context files ─────────────────────────────────────────────────────────────

export function upsertContextFile(
  db: Database,
  params: { id: string; name: string; content: string },
): ContextFile {
  const now = Date.now()
  db.run(
    `INSERT INTO context_files (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, updated_at = excluded.updated_at`,
    [params.id, params.name, params.content, now, now],
  )
  return db.query<ContextFile, string>('SELECT * FROM context_files WHERE id = ?').get(params.id)!
}

export function getContextFile(db: Database, id: string): ContextFile | null {
  return db.query<ContextFile, string>('SELECT * FROM context_files WHERE id = ?').get(id)
}

export function listContextFiles(db: Database): ContextFile[] {
  return db.query<ContextFile, []>('SELECT * FROM context_files ORDER BY name ASC').all()
}

export function deleteContextFile(db: Database, id: string): void {
  db.run('DELETE FROM context_files WHERE id = ?', [id])
}

// ── Project resource assignments ──────────────────────────────────────────────

export function setProjectAgents(db: Database, projectId: string, agentIds: string[]): void {
  db.run('DELETE FROM project_agents WHERE project_id = ?', [projectId])
  const insert = db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id) VALUES (?, ?)')
  const run = db.transaction(() => { for (const id of agentIds) insert.run(projectId, id) })
  run()
}

export function getProjectAgents(db: Database, projectId: string): Agent[] {
  return db.query<Agent, string>(
    `SELECT a.* FROM agents a
     JOIN project_agents pa ON pa.agent_id = a.id
     WHERE pa.project_id = ? ORDER BY a.name ASC`,
  ).all(projectId)
}

export function setProjectSkills(db: Database, projectId: string, skillIds: string[]): void {
  db.run('DELETE FROM project_skills WHERE project_id = ?', [projectId])
  const insert = db.prepare('INSERT OR IGNORE INTO project_skills (project_id, skill_id) VALUES (?, ?)')
  const run = db.transaction(() => { for (const id of skillIds) insert.run(projectId, id) })
  run()
}

export function getProjectSkills(db: Database, projectId: string): Skill[] {
  return db.query<Skill, string>(
    `SELECT s.* FROM skills s
     JOIN project_skills ps ON ps.skill_id = s.id
     WHERE ps.project_id = ? ORDER BY s.name ASC`,
  ).all(projectId)
}

export function setProjectContextFiles(
  db: Database,
  projectId: string,
  contextFileIds: string[],
): void {
  db.run('DELETE FROM project_context_files WHERE project_id = ?', [projectId])
  const insert = db.prepare(
    'INSERT OR IGNORE INTO project_context_files (project_id, context_file_id) VALUES (?, ?)',
  )
  const run = db.transaction(() => { for (const id of contextFileIds) insert.run(projectId, id) })
  run()
}

export function getProjectContextFiles(db: Database, projectId: string): ContextFile[] {
  return db.query<ContextFile, string>(
    `SELECT cf.* FROM context_files cf
     JOIN project_context_files pcf ON pcf.context_file_id = cf.id
     WHERE pcf.project_id = ? ORDER BY cf.name ASC`,
  ).all(projectId)
}

/** Upsert an MCP assignment for a project, with optional per-project credential overrides. */
export function setProjectMcp(
  db: Database,
  projectId: string,
  mcpId: string,
  envOverride?: Record<string, string>,
): void {
  const env = envOverride && Object.keys(envOverride).length > 0
    ? JSON.stringify(envOverride)
    : null
  db.run(
    `INSERT INTO project_mcps (project_id, mcp_id, env_override) VALUES (?, ?, ?)
     ON CONFLICT(project_id, mcp_id) DO UPDATE SET env_override = excluded.env_override`,
    [projectId, mcpId, env],
  )
}

export function removeProjectMcp(db: Database, projectId: string, mcpId: string): void {
  db.run('DELETE FROM project_mcps WHERE project_id = ? AND mcp_id = ?', [projectId, mcpId])
}

export interface ResolvedProjectMcp {
  server: McpServer
  /** Merged env: server defaults overridden by project-specific values */
  env: Record<string, string>
}

/** Returns MCP servers assigned to a project with their fully-merged env. */
export function getProjectMcps(db: Database, projectId: string): ResolvedProjectMcp[] {
  const rows = db.query<McpServer & { env_override: string | null }, string>(
    `SELECT m.*, pm.env_override FROM mcp_servers m
     JOIN project_mcps pm ON pm.mcp_id = m.id
     WHERE pm.project_id = ? ORDER BY m.name ASC`,
  ).all(projectId)

  return rows.map(({ env_override, ...server }) => {
    const base: Record<string, string> = server.env ? JSON.parse(server.env) : {}
    const override: Record<string, string> = env_override ? JSON.parse(env_override) : {}
    return { server, env: { ...base, ...override } }
  })
}
