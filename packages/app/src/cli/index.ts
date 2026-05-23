#!/usr/bin/env bun
import { Command } from 'commander'
import path from 'node:path'
import { existsSync } from 'node:fs'

import {
  sendMessage,
  detectAgents,
  getAgentDef,
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
  getFileChangesForSession,
  getFileChangesForRun,
} from '@runner/core'
import type { AgentEvent } from '@runner/core'

const REPO_ROOT = path.resolve(import.meta.dir, '../../../..')
const SKILLS_ROOTS = [path.join(REPO_ROOT, 'user-skills'), path.join(REPO_ROOT, 'skills')]

function shortId(id: string) { return id.slice(0, 8) }
function fmtDate(ts: number) { return new Date(ts).toLocaleString() }

function printEvent(event: AgentEvent) {
  if (event.type === 'text') process.stdout.write(event.text)
  else if (event.type === 'tool_use') process.stderr.write(`\n[tool] ${event.name}\n`)
  else if (event.type === 'error') process.stderr.write(`\n[error] ${event.message}\n`)
}

const program = new Command().name('runner').description('opencode-runner CLI').version('0.1.0')

// ── projects ──────────────────────────────────────────────────────────────────

const pCmd = program.command('projects').description('Manage projects')

pCmd.command('add <folder>').description('Register a folder as a project').option('-n, --name <name>').action((folder: string, opts: { name?: string }) => {
  const absPath = path.resolve(folder)
  if (!existsSync(absPath)) { console.error(`Not found: ${absPath}`); process.exit(1) }
  const db = getDb()
  if (getProjectByPath(db, absPath)) { console.error('Already registered'); process.exit(1) }
  const p = createProject(db, { id: crypto.randomUUID(), name: opts.name ?? path.basename(absPath), path: absPath })
  console.log(`Added  ${shortId(p.id)}  "${p.name}"`)
})

pCmd.command('list').option('--json').action((opts: { json?: boolean }) => {
  const db = getDb()
  const projects = listProjects(db)
  if (opts.json) { console.log(JSON.stringify(projects, null, 2)); return }
  if (!projects.length) { console.log('No projects. Use: projects add <folder>'); return }
  for (const p of projects) {
    console.log(`  ${shortId(p.id)}  ${p.name}  (${listSessions(db, p.id).length} sessions)`)
    console.log(`         ${p.path}`)
  }
})

pCmd.command('remove <id>').action((id: string) => {
  const db = getDb()
  const p = getProject(db, id) ?? listProjects(db).find((x) => x.id.startsWith(id))
  if (!p) { console.error('Not found'); process.exit(1) }
  deleteProject(db, p.id); console.log(`Removed "${p.name}"`)
})

// ── sessions ──────────────────────────────────────────────────────────────────

const sCmd = program.command('sessions').description('Manage sessions')

sCmd.command('list').option('-p, --project <id>').option('--json').action((opts: { project?: string; json?: boolean }) => {
  const db = getDb()
  let projectId: string | undefined
  if (opts.project) {
    const p = listProjects(db).find((x) => x.id.startsWith(opts.project!))
    if (!p) { console.error('Project not found'); process.exit(1) }
    projectId = p.id
  }
  const sessions = listSessions(db, projectId)
  if (opts.json) { console.log(JSON.stringify(sessions, null, 2)); return }
  const pMap = new Map(listProjects(db).map((p) => [p.id, p]))
  for (const s of sessions) {
    const proj = s.project_id ? pMap.get(s.project_id) : null
    console.log(`  ${shortId(s.id)}  ${proj ? `[${proj.name}] ` : ''}${s.name}`)
    console.log(`         ${s.agent_id}${s.skill_id ? ` · ${s.skill_id}` : ''} · ${fmtDate(s.updated_at)}`)
  }
})

sCmd.command('new').option('-p, --project <id>').option('-a, --agent <id>', '', 'opencode').option('-s, --skill <id>').option('-m, --model <id>').option('-n, --name <name>').action((opts: { project?: string; agent: string; skill?: string; model?: string; name?: string }) => {
  const db = getDb()
  let projectId: string | undefined
  if (opts.project) {
    const p = listProjects(db).find((x) => x.id.startsWith(opts.project!))
    if (!p) { console.error('Project not found'); process.exit(1) }
    projectId = p.id
  }
  const s = createSession(db, { id: crypto.randomUUID(), projectId, name: opts.name ?? 'New session', agentId: opts.agent, skillId: opts.skill, model: opts.model })
  console.log(`Created session ${shortId(s.id)}  "${s.name}"`)
  console.log(`Resume: runner chat --session ${s.id} --message "..."`)
})

sCmd.command('show <id>').action((id: string) => {
  const db = getDb()
  const s = getSession(db, id) ?? listSessions(db).find((x) => x.id.startsWith(id))
  if (!s) { console.error('Not found'); process.exit(1) }
  const proj = s.project_id ? getProject(db, s.project_id) : null
  console.log(`\nSession: ${s.id}`)
  if (proj) console.log(`Project: ${proj.name} (${proj.path})`)
  console.log(`Agent  : ${s.agent_id}${s.skill_id ? ` · ${s.skill_id}` : ''}`)
  if (s.external_session_id) console.log(`Native : ${s.external_session_id}`)
  for (const m of getMessages(db, s.id)) console.log(`\n[${m.role.toUpperCase()}]\n${m.content}`)
})

sCmd.command('changes <id>').option('-r, --run <id>').option('--diff').option('--json').action((id: string, opts: { run?: string; diff?: boolean; json?: boolean }) => {
  const db = getDb()
  const s = getSession(db, id) ?? listSessions(db).find((x) => x.id.startsWith(id))
  if (!s) { console.error('Not found'); process.exit(1) }
  const changes = opts.run ? getFileChangesForRun(db, opts.run) : getFileChangesForSession(db, s.id)
  if (opts.json) { console.log(JSON.stringify(changes, null, 2)); return }
  if (!changes.length) { console.log('No file changes recorded.'); return }
  const SYM: Record<string, string> = { added: '+', modified: '~', deleted: '-' }
  const byRun = new Map<string, typeof changes>()
  for (const c of changes) { if (!byRun.has(c.run_id)) byRun.set(c.run_id, []); byRun.get(c.run_id)!.push(c) }
  for (const [runId, rc] of byRun) {
    console.log(`\nRun ${shortId(runId)}:`)
    for (const c of rc) {
      console.log(`  ${SYM[c.change_type] ?? '?'} ${c.path}`)
      if (opts.diff && c.diff) console.log(c.diff.split('\n').map((l) => '    ' + l).join('\n'))
    }
  }
})

sCmd.command('remove <id>').action((id: string) => {
  const db = getDb()
  const s = getSession(db, id) ?? listSessions(db).find((x) => x.id.startsWith(id))
  if (!s) { console.error('Not found'); process.exit(1) }
  deleteSession(db, s.id); console.log(`Deleted "${s.name}"`)
})

// ── chat ──────────────────────────────────────────────────────────────────────

program.command('chat')
  .requiredOption('-m, --message <text>')
  .option('--session <id>')
  .option('-p, --project <id>')
  .option('-a, --agent <id>')
  .option('-s, --skill <id>')
  .option('--model <id>')
  .option('-c, --context <text>')
  .option('-f, --context-file <path>')
  .option('--json')
  .action(async (opts: { message: string; session?: string; project?: string; agent?: string; skill?: string; model?: string; context?: string; contextFile?: string; json?: boolean }) => {
    const db = getDb()
    let sessionId: string | undefined
    if (opts.session) {
      const s = getSession(db, opts.session) ?? listSessions(db).find((x) => x.id.startsWith(opts.session!))
      if (!s) { console.error('Session not found'); process.exit(1) }
      sessionId = s.id
    }
    let projectId: string | undefined
    if (opts.project && !sessionId) {
      const p = listProjects(db).find((x) => x.id.startsWith(opts.project!))
      if (!p) { console.error('Project not found'); process.exit(1) }
      projectId = p.id
    }
    try {
      const result = await sendMessage({
        sessionId,
        newSession: sessionId ? undefined : { projectId, agentId: opts.agent, skillId: opts.skill, model: opts.model },
        message: opts.message,
        context: opts.context,
        contextFile: opts.contextFile,
        onEvent: (e) => opts.json ? console.log(JSON.stringify(e)) : printEvent(e),
      })
      if (!opts.json) console.error(`\nSession: ${result.sessionId}`)
      process.exit(result.exitCode)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ── agents / skills ───────────────────────────────────────────────────────────

program.command('agents').option('--json').action(async (opts: { json?: boolean }) => {
  const agents = await detectAgents()
  if (opts.json) { console.log(JSON.stringify(agents, null, 2)); return }
  for (const a of agents) {
    const mark = a.available ? '✓' : '✗'
    console.log(`  ${mark} ${a.name}${a.version ? ` v${a.version}` : ''}${a.available ? ` (${a.models.length} models)` : ''}`)
    if (!a.available && getAgentDef(a.id)?.installUrl) console.log(`    ${getAgentDef(a.id)?.installUrl}`)
  }
})

const skillCmd = program.command('skills')
skillCmd.command('list').option('--json').action(async (opts: { json?: boolean }) => {
  const skills = await loadSkills(SKILLS_ROOTS)
  if (opts.json) { console.log(JSON.stringify(skills.map(({ id, name, description, tags }) => ({ id, name, description, tags })), null, 2)); return }
  for (const s of skills) console.log(`  ${s.id}${s.tags.length ? ` [${s.tags.join(', ')}]` : ''}\n    ${s.description}`)
})

program.parseAsync(process.argv)
