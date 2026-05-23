import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import path from 'node:path'
import { existsSync } from 'node:fs'

import { sendMessage } from '../runner.ts'
import { detectAgents } from '../runtimes/detection.ts'
import { loadSkills } from '../skills/loader.ts'
import {
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
  getFileChangesForRun,
  getFileChangesForSession,
} from '../db/index.ts'

const app = new Hono()

const SKILLS_ROOTS = [
  path.join(process.cwd(), 'user-skills'),
  path.join(process.cwd(), 'skills'),
]

// ── Agents ────────────────────────────────────────────────────────────────────

app.get('/api/agents', async (c) => {
  return c.json(await detectAgents())
})

// ── Skills ────────────────────────────────────────────────────────────────────

app.get('/api/skills', async (c) => {
  const skills = await loadSkills(SKILLS_ROOTS)
  return c.json(
    skills.map(({ id, name, description, tags, source }) => ({ id, name, description, tags, source })),
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/projects', (c) => {
  const db = getDb()
  const projects = listProjects(db)
  return c.json(
    projects.map((p) => ({
      ...p,
      sessionCount: listSessions(db, p.id).length,
    })),
  )
})

app.post('/api/projects', async (c) => {
  const body = await c.req.json<{ path: string; name?: string }>()
  if (!body.path?.trim()) return c.json({ error: 'path is required' }, 400)

  const absPath = path.resolve(body.path)
  if (!existsSync(absPath)) return c.json({ error: `Folder not found: ${absPath}` }, 400)

  const db = getDb()
  if (getProjectByPath(db, absPath)) {
    return c.json({ error: 'Project already registered for this path' }, 409)
  }

  const project = createProject(db, {
    id: crypto.randomUUID(),
    name: body.name ?? path.basename(absPath),
    path: absPath,
  })
  return c.json(project, 201)
})

app.get('/api/projects/:id', (c) => {
  const db = getDb()
  const project = getProject(db, c.req.param('id'))
  if (!project) return c.json({ error: 'Not found' }, 404)
  return c.json(project)
})

app.patch('/api/projects/:id', async (c) => {
  const db = getDb()
  const project = getProject(db, c.req.param('id'))
  if (!project) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string }>()
  updateProject(db, project.id, { name: body.name })
  return c.json(getProject(db, project.id))
})

app.delete('/api/projects/:id', (c) => {
  const db = getDb()
  const project = getProject(db, c.req.param('id'))
  if (!project) return c.json({ error: 'Not found' }, 404)
  deleteProject(db, project.id)
  return c.json({ ok: true })
})

// ── Sessions under a project ──────────────────────────────────────────────────

app.get('/api/projects/:id/sessions', (c) => {
  const db = getDb()
  const project = getProject(db, c.req.param('id'))
  if (!project) return c.json({ error: 'Not found' }, 404)
  return c.json(listSessions(db, project.id))
})

app.post('/api/projects/:id/sessions', async (c) => {
  const db = getDb()
  const project = getProject(db, c.req.param('id'))
  if (!project) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{
    name?: string
    agentId?: string
    skillId?: string
    model?: string
  }>()

  const session = createSession(db, {
    id: crypto.randomUUID(),
    projectId: project.id,
    name: body.name ?? 'New session',
    agentId: body.agentId ?? 'opencode',
    skillId: body.skillId,
    model: body.model,
  })
  return c.json(session, 201)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Sessions (standalone)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/sessions', (c) => {
  const db = getDb()
  return c.json(listSessions(db))
})

app.post('/api/sessions', async (c) => {
  const db = getDb()
  const body = await c.req.json<{
    name?: string
    agentId?: string
    skillId?: string
    model?: string
  }>()
  const session = createSession(db, {
    id: crypto.randomUUID(),
    name: body.name ?? 'New session',
    agentId: body.agentId ?? 'opencode',
    skillId: body.skillId,
    model: body.model,
  })
  return c.json(session, 201)
})

app.get('/api/sessions/:id', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(session)
})

app.patch('/api/sessions/:id', async (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<{ name?: string }>()
  if (body.name) renameSession(db, session.id, body.name)
  return c.json(getSession(db, session.id))
})

app.delete('/api/sessions/:id', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  deleteSession(db, session.id)
  return c.json({ ok: true })
})

app.get('/api/sessions/:id/messages', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(getMessages(db, session.id))
})

/**
 * POST /api/sessions/:id/messages
 * Send a message into a session and stream agent events as SSE.
 */
app.post('/api/sessions/:id/messages', async (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json<{
    content: string
    context?: string
  }>()

  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)

  return stream(c, async (s) => {
    const sse = (name: string, data: unknown) =>
      s.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)

    try {
      const result = await sendMessage({
        sessionId: session.id,
        message: body.content,
        context: body.context,
        onEvent: (event) => sse('agent', event),
      })
      sse('done', { sessionId: result.sessionId, runId: result.runId, exitCode: result.exitCode })
    } catch (err) {
      sse('error', { message: err instanceof Error ? err.message : String(err) })
    }
  })
})

app.get('/api/sessions/:id/runs/:runId/events', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(getEvents(db, c.req.param('runId')))
})

app.get('/api/sessions/:id/runs/:runId/changes', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(getFileChangesForRun(db, c.req.param('runId')))
})

/** All file changes across all runs in a session */
app.get('/api/sessions/:id/changes', (c) => {
  const db = getDb()
  const session = getSession(db, c.req.param('id'))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(getFileChangesForSession(db, session.id))
})

// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000)
export default { port: PORT, fetch: app.fetch }

console.log(`opencode-runner API listening on http://localhost:${PORT}`)
