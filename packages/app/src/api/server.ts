import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { serveStatic } from 'hono/bun'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'

import {
  sendMessage,
  detectAgents,
  loadSkills,
  getDb,
  listProjects,
  getProject,
  getProjectByPath,
  createProject,
  updateProject,
  deleteProject,
  listSessions,
  getSession,
  createSession,
  deleteSession,
  renameSession,
  getMessages,
  getEvents,
  getExchanges,
  getFileChangesForRun,
  getFileChangesForSession,
  // resources
  listAgentRecords,
  getAgentRecord,
  upsertAgent,
  deleteAgent,
  listSkills,
  getSkill,
  upsertSkill,
  deleteSkill,
  listMcpServers,
  getMcpServer,
  upsertMcpServer,
  deleteMcpServer,
  listContextFiles,
  getContextFile,
  upsertContextFile,
  deleteContextFile,
  // project assignments
  getProjectAgents,
  setProjectAgents,
  getProjectSkills,
  setProjectSkills,
  getProjectContextFiles,
  setProjectContextFiles,
  assignProjectContextFile,
  unassignProjectContextFile,
  getProjectMcps,
  setProjectMcp,
  removeProjectMcp,
} from '@runner/core'

const app = new Hono()

// ── Event deserialization ─────────────────────────────────────────────────────

interface EventData { type: string; [key: string]: unknown }
interface DeserializedEvent { id: number; run_id: string; type: string; data: EventData; created_at: number }

/** Remove redundant sessionID from the opencode payload and its part sub-object. */
function stripNoise(obj: Record<string, unknown>): Record<string, unknown> {
  const { sessionID: _s, timestamp: _t, ...rest } = obj
  if (rest.part != null && typeof rest.part === 'object') {
    const { sessionID: _ps, ...part } = rest.part as Record<string, unknown>
    rest.part = part
  }
  return rest
}

/**
 * Parse `ev.data` (a JSON string from the DB) into an object.
 * For `raw` events, unwrap the double-encoded inner opencode payload.
 */
function deserializeEvent(ev: { id: number; run_id: string; type: string; data: string; created_at: number }): DeserializedEvent {
  let parsed: unknown
  try { parsed = JSON.parse(ev.data) } catch { return { ...ev, data: { type: 'raw', payload: ev.data } } }

  if (parsed !== null && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>
    if (p.type === 'raw' && typeof p.data === 'string') {
      try {
        const inner = JSON.parse(p.data) as Record<string, unknown>
        return { id: ev.id, run_id: ev.run_id, type: ev.type, data: stripNoise(inner) as EventData, created_at: ev.created_at }
      } catch { /* fall through */ }
    }
  }

  return { id: ev.id, run_id: ev.run_id, type: ev.type, data: parsed as EventData, created_at: ev.created_at }
}

/**
 * Collapse opencode step_start / step_finish pairs into a single `step` event.
 * Events between the boundaries become nested under the step.
 */
function groupByStep(events: DeserializedEvent[]): DeserializedEvent[] {
  const result: DeserializedEvent[] = []
  let buffer: DeserializedEvent[] = []
  let inStep = false

  for (const ev of events) {
    const type = ev.data.type
    if (type === 'step_start') {
      inStep = true
      buffer = []
    } else if (type === 'step_finish' && inStep) {
      const part = (ev.data.part ?? {}) as Record<string, unknown>
      result.push({
        ...ev,
        type: 'step',
        data: {
          type: 'step',
          reason: part.reason ?? 'stop',
          tokens: part.tokens,
          cost: part.cost,
          events: buffer.map((e) => e.data),
        } as EventData,
      })
      inStep = false
      buffer = []
    } else if (inStep) {
      buffer.push(ev)
    } else {
      result.push(ev)
    }
  }

  // Flush in-progress step (run still active)
  result.push(...buffer)
  return result
}

// ── opencode server discovery ─────────────────────────────────────────────────

async function resolveOpencodeServer(): Promise<string | null> {
  // 1. Explicit env override
  if (process.env.OPENCODE_SERVER) return process.env.OPENCODE_SERVER.replace(/\/$/, '')

  // 2. Well-known file locations opencode writes at startup
  const candidates = [
    path.join(os.homedir(), '.opencode', 'server'),
    path.join(os.homedir(), '.config', 'opencode', 'server'),
    path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode', 'server'),
  ]
  for (const f of candidates) {
    if (existsSync(f)) {
      try {
        const url = readFileSync(f, 'utf8').trim()
        if (url) return url.replace(/\/$/, '')
      } catch {}
    }
  }

  // 3. Try default port as last resort
  try {
    const r = await fetch('http://localhost:4242/session', { signal: AbortSignal.timeout(1000) })
    if (r.ok) return 'http://localhost:4242'
  } catch {}

  return null
}

const REPO_ROOT = path.resolve(import.meta.dir, '../../../..')
const SKILLS_ROOTS = [
  path.join(REPO_ROOT, 'user-skills'),
  path.join(REPO_ROOT, 'skills'),
]

// ── Static web app ────────────────────────────────────────────────────────────

const PUBLIC_DIR = path.resolve(import.meta.dir, '../../public')

app.use('/*', serveStatic({ root: PUBLIC_DIR }))

app.get('/', (c) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html')
  if (!existsSync(indexPath)) {
    return c.text('Web not built yet. Run: bun run build:web', 503)
  }
  return c.html(Bun.file(indexPath).text())
})

// ── Agents ────────────────────────────────────────────────────────────────────

app.get('/api/agents', async (c) => c.json(await detectAgents()))

// ── Skills ────────────────────────────────────────────────────────────────────

app.get('/api/skills', async (c) => {
  const skills = await loadSkills(SKILLS_ROOTS)
  return c.json(skills.map(({ id, name, description, tags, source }) => ({ id, name, description, tags, source })))
})

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', (c) => {
  const db = getDb()
  return c.json(listProjects(db).map((p) => ({ ...p, sessionCount: listSessions(db, p.id).length })))
})

app.post('/api/projects', async (c) => {
  const body = await c.req.json<{ path: string; name?: string }>()
  if (!body.path?.trim()) return c.json({ error: 'path is required' }, 400)
  const absPath = path.resolve(body.path)
  if (!existsSync(absPath)) return c.json({ error: `Folder not found: ${absPath}` }, 400)
  const db = getDb()
  if (getProjectByPath(db, absPath)) return c.json({ error: 'Project already registered' }, 409)
  return c.json(createProject(db, { id: crypto.randomUUID(), name: body.name ?? path.basename(absPath), path: absPath }), 201)
})

app.get('/api/projects/:id', (c) => {
  const p = getProject(getDb(), c.req.param('id'))
  return p ? c.json(p) : c.json({ error: 'Not found' }, 404)
})

app.patch('/api/projects/:id', async (c) => {
  const db = getDb()
  const p = getProject(db, c.req.param('id'))
  if (!p) return c.json({ error: 'Not found' }, 404)
  const { name } = await c.req.json<{ name?: string }>()
  updateProject(db, p.id, { name })
  return c.json(getProject(db, p.id))
})

app.delete('/api/projects/:id', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteProject(db, c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/api/projects/:id/sessions', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  return c.json(listSessions(db, c.req.param('id')))
})

app.post('/api/projects/:id/sessions', async (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string; agentId?: string; skillId?: string; model?: string }>()
  return c.json(createSession(db, {
    id: crypto.randomUUID(),
    projectId: c.req.param('id'),
    name: body.name ?? 'New session',
    agentId: body.agentId ?? 'opencode',
    skillId: body.skillId,
    model: body.model,
  }), 201)
})

// ── Sessions ──────────────────────────────────────────────────────────────────

app.get('/api/sessions', (c) => c.json(listSessions(getDb())))

app.post('/api/sessions', async (c) => {
  const body = await c.req.json<{ name?: string; agentId?: string; skillId?: string; model?: string }>()
  return c.json(createSession(getDb(), {
    id: crypto.randomUUID(),
    name: body.name ?? 'New session',
    agentId: body.agentId ?? 'opencode',
    skillId: body.skillId,
    model: body.model,
  }), 201)
})

app.get('/api/sessions/:id', (c) => {
  const s = getSession(getDb(), c.req.param('id'))
  return s ? c.json(s) : c.json({ error: 'Not found' }, 404)
})

app.patch('/api/sessions/:id', async (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  if (!s) return c.json({ error: 'Not found' }, 404)
  const { name } = await c.req.json<{ name?: string }>()
  if (name) renameSession(db, s.id, name)
  return c.json(getSession(db, s.id))
})

app.delete('/api/sessions/:id', (c) => {
  const db = getDb()
  if (!getSession(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteSession(db, c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/api/sessions/:id/messages', (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  return s ? c.json(getMessages(db, s.id)) : c.json({ error: 'Not found' }, 404)
})

/**
 * Fetch raw messages from opencode's own API for sessions with an external_session_id.
 * opencode's server address is discovered from the OPENCODE_SERVER env var or
 * a well-known file written by opencode at startup.
 */
app.get('/api/sessions/:id/opencode-messages', async (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (!s.external_session_id) return c.json({ error: 'No opencode session linked yet' }, 409)

  const base = await resolveOpencodeServer()
  if (!base) return c.json({ error: 'opencode server not reachable' }, 503)

  try {
    const resp = await fetch(`${base}/session/${s.external_session_id}/message`)
    if (!resp.ok) return c.json({ error: `opencode API: ${resp.status}` }, 502)
    return c.json(await resp.json())
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
  }
})

app.get('/api/sessions/:id/exchanges', (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  if (!s) return c.json({ error: 'Not found' }, 404)
  const exchanges = getExchanges(db, s.id).map((ex) => ({
    ...ex,
    events: undefined,
    steps: groupByStep(ex.events.map(deserializeEvent)),
  }))
  return c.json(exchanges)
})

app.post('/api/sessions/:id/messages', async (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  if (!s) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ content: string; context?: string }>()
  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)

  return stream(c, async (st) => {
    const sse = (name: string, data: unknown) => st.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    try {
      const result = await sendMessage({ sessionId: s.id, message: body.content, context: body.context, onEvent: (e) => sse('agent', e) })
      sse('done', { sessionId: result.sessionId, runId: result.runId, exitCode: result.exitCode })
    } catch (err) {
      sse('error', { message: err instanceof Error ? err.message : String(err) })
    }
  })
})

app.get('/api/sessions/:id/changes', (c) => {
  const db = getDb()
  const s = getSession(db, c.req.param('id'))
  return s ? c.json(getFileChangesForSession(db, s.id)) : c.json({ error: 'Not found' }, 404)
})

app.get('/api/sessions/:id/runs/:runId/events', (c) => {
  const db = getDb()
  return getSession(db, c.req.param('id'))
    ? c.json(getEvents(db, c.req.param('runId')))
    : c.json({ error: 'Not found' }, 404)
})

app.get('/api/sessions/:id/runs/:runId/changes', (c) => {
  const db = getDb()
  return getSession(db, c.req.param('id'))
    ? c.json(getFileChangesForRun(db, c.req.param('runId')))
    : c.json({ error: 'Not found' }, 404)
})

// ── Resource library — agents ─────────────────────────────────────────────────

app.get('/api/resources/agents', (c) => c.json(listAgentRecords(getDb())))

app.post('/api/resources/agents', async (c) => {
  const body = await c.req.json<{ name?: string; content?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)
  const id = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return c.json(upsertAgent(getDb(), { id, name: body.name.trim(), content: body.content.trim() }), 201)
})

app.get('/api/resources/agents/:id', (c) => {
  const a = getAgentRecord(getDb(), c.req.param('id'))
  return a ? c.json(a) : c.json({ error: 'Not found' }, 404)
})

app.put('/api/resources/agents/:id', async (c) => {
  const db = getDb()
  if (!getAgentRecord(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string; content?: string }>()
  return c.json(upsertAgent(db, { id: c.req.param('id'), name: body.name?.trim() ?? c.req.param('id'), content: body.content?.trim() ?? '' }))
})

app.delete('/api/resources/agents/:id', (c) => {
  const db = getDb()
  if (!getAgentRecord(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteAgent(db, c.req.param('id'))
  return c.json({ ok: true })
})

// ── Resource library — skills ─────────────────────────────────────────────────

app.get('/api/resources/skills', (c) => c.json(listSkills(getDb())))

app.post('/api/resources/skills', async (c) => {
  const body = await c.req.json<{ name?: string; content?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)
  const id = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return c.json(upsertSkill(getDb(), { id, name: body.name.trim(), content: body.content.trim() }), 201)
})

app.get('/api/resources/skills/:id', (c) => {
  const s = getSkill(getDb(), c.req.param('id'))
  return s ? c.json(s) : c.json({ error: 'Not found' }, 404)
})

app.put('/api/resources/skills/:id', async (c) => {
  const db = getDb()
  if (!getSkill(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string; content?: string }>()
  return c.json(upsertSkill(db, { id: c.req.param('id'), name: body.name?.trim() ?? c.req.param('id'), content: body.content?.trim() ?? '' }))
})

app.delete('/api/resources/skills/:id', (c) => {
  const db = getDb()
  if (!getSkill(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteSkill(db, c.req.param('id'))
  return c.json({ ok: true })
})

// ── Resource library — MCP servers ───────────────────────────────────────────

app.get('/api/resources/mcps', (c) => {
  return c.json(listMcpServers(getDb()).map((m) => ({
    ...m,
    command: JSON.parse(m.command) as string[],
    env: m.env ? JSON.parse(m.env) as Record<string, string> : null,
  })))
})

app.post('/api/resources/mcps', async (c) => {
  const body = await c.req.json<{ id?: string; name?: string; command?: unknown; env?: unknown }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!Array.isArray(body.command) || body.command.length === 0) return c.json({ error: 'command must be a non-empty array' }, 400)
  const id = (body.id ?? body.name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const env = body.env && typeof body.env === 'object' && !Array.isArray(body.env) ? body.env as Record<string, string> : undefined
  return c.json(upsertMcpServer(getDb(), { id, name: body.name.trim(), command: body.command.map(String), env }), 201)
})

app.get('/api/resources/mcps/:id', (c) => {
  const m = getMcpServer(getDb(), c.req.param('id'))
  if (!m) return c.json({ error: 'Not found' }, 404)
  return c.json({ ...m, command: JSON.parse(m.command), env: m.env ? JSON.parse(m.env) : null })
})

app.put('/api/resources/mcps/:id', async (c) => {
  const db = getDb()
  if (!getMcpServer(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string; command?: unknown; env?: unknown }>()
  if (!Array.isArray(body.command) || body.command.length === 0) return c.json({ error: 'command must be a non-empty array' }, 400)
  const env = body.env && typeof body.env === 'object' && !Array.isArray(body.env) ? body.env as Record<string, string> : undefined
  const m = upsertMcpServer(db, { id: c.req.param('id'), name: body.name?.trim() ?? c.req.param('id'), command: (body.command as unknown[]).map(String), env })
  return c.json({ ...m, command: JSON.parse(m.command), env: m.env ? JSON.parse(m.env) : null })
})

app.delete('/api/resources/mcps/:id', (c) => {
  const db = getDb()
  if (!getMcpServer(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteMcpServer(db, c.req.param('id'))
  return c.json({ ok: true })
})

// ── Resource library — context files ─────────────────────────────────────────

app.get('/api/resources/contexts', (c) => c.json(listContextFiles(getDb())))

app.post('/api/resources/contexts', async (c) => {
  const body = await c.req.json<{ name?: string; type?: string; content?: string }>()
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)
  const id = body.name.trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-')
  return c.json(upsertContextFile(getDb(), { id, name: body.name.trim(), type: body.type?.trim() || undefined, content: body.content.trim() }), 201)
})

app.get('/api/resources/contexts/:id', (c) => {
  const f = getContextFile(getDb(), c.req.param('id'))
  return f ? c.json(f) : c.json({ error: 'Not found' }, 404)
})

app.put('/api/resources/contexts/:id', async (c) => {
  const db = getDb()
  if (!getContextFile(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string; type?: string; content?: string }>()
  return c.json(upsertContextFile(db, { id: c.req.param('id'), name: body.name?.trim() ?? c.req.param('id'), type: body.type?.trim() || undefined, content: body.content?.trim() ?? '' }))
})

app.delete('/api/resources/contexts/:id', (c) => {
  const db = getDb()
  if (!getContextFile(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  deleteContextFile(db, c.req.param('id'))
  return c.json({ ok: true })
})

// ── Project resource assignments ──────────────────────────────────────────────

app.get('/api/projects/:id/resources', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const pid = c.req.param('id')
  return c.json({
    agents: getProjectAgents(db, pid),
    skills: getProjectSkills(db, pid),
    contexts: getProjectContextFiles(db, pid),
    mcps: getProjectMcps(db, pid).map(({ server, env }) => ({
      ...server,
      command: JSON.parse(server.command) as string[],
      env,
    })),
  })
})

app.put('/api/projects/:id/resources/agents', async (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const { ids } = await c.req.json<{ ids: string[] }>()
  if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400)
  setProjectAgents(db, c.req.param('id'), ids)
  return c.json(getProjectAgents(db, c.req.param('id')))
})

app.put('/api/projects/:id/resources/skills', async (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const { ids } = await c.req.json<{ ids: string[] }>()
  if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400)
  setProjectSkills(db, c.req.param('id'), ids)
  return c.json(getProjectSkills(db, c.req.param('id')))
})

app.put('/api/projects/:id/resources/contexts', async (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  const { ids } = await c.req.json<{ ids: string[] }>()
  if (!Array.isArray(ids)) return c.json({ error: 'ids must be an array' }, 400)
  setProjectContextFiles(db, c.req.param('id'), ids)
  return c.json(getProjectContextFiles(db, c.req.param('id')))
})

app.post('/api/projects/:id/resources/contexts/:contextId', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  if (!getContextFile(db, c.req.param('contextId'))) return c.json({ error: 'Context file not found' }, 404)
  try {
    assignProjectContextFile(db, c.req.param('id'), c.req.param('contextId'))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  return c.json(getProjectContextFiles(db, c.req.param('id')))
})

app.delete('/api/projects/:id/resources/contexts/:contextId', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  unassignProjectContextFile(db, c.req.param('id'), c.req.param('contextId'))
  return c.json({ ok: true })
})

app.put('/api/projects/:id/resources/mcps/:mcpId', async (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  if (!getMcpServer(db, c.req.param('mcpId'))) return c.json({ error: 'MCP server not found' }, 404)
  const body = await c.req.json<{ envOverride?: Record<string, string> }>()
  setProjectMcp(db, c.req.param('id'), c.req.param('mcpId'), body.envOverride)
  return c.json(getProjectMcps(db, c.req.param('id')).map(({ server, env }) => ({
    ...server, command: JSON.parse(server.command), env,
  })))
})

app.delete('/api/projects/:id/resources/mcps/:mcpId', (c) => {
  const db = getDb()
  if (!getProject(db, c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  removeProjectMcp(db, c.req.param('id'), c.req.param('mcpId'))
  return c.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000)
export default { port: PORT, fetch: app.fetch }
console.log(`opencode-runner  http://localhost:${PORT}`)
