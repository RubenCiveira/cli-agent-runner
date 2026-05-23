#!/usr/bin/env bun
import { Command } from 'commander'
import path from 'node:path'
import { existsSync } from 'node:fs'

import type { AgentEvent } from '../runtimes/types.ts'
import { sendMessage } from '../runner.ts'
import { detectAgents } from '../runtimes/detection.ts'
import { loadSkills } from '../skills/loader.ts'
import { getAgentDef } from '../runtimes/registry.ts'
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
  getFileChangesForSession,
  getFileChangesForRun,
} from '../db/index.ts'

const SKILLS_ROOTS = [
  path.join(process.cwd(), 'user-skills'),
  path.join(process.cwd(), 'skills'),
]

// ── Output helpers ────────────────────────────────────────────────────────────

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.text)
      break
    case 'tool_use':
      process.stderr.write(`\n[tool] ${event.name}\n`)
      break
    case 'error':
      process.stderr.write(`\n[error] ${event.message}\n`)
      break
  }
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString()
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command()
  .name('runner')
  .description('Launch AI agents with skills, projects and persistent sessions')
  .version('0.1.0')

// ═══════════════════════════════════════════════════════════════════════════════
// projects
// ═══════════════════════════════════════════════════════════════════════════════

const projectsCmd = program.command('projects').description('Manage projects')

projectsCmd
  .command('add <folder>')
  .description('Add a folder as a project')
  .option('-n, --name <name>', 'Display name (defaults to folder name)')
  .action((folder: string, opts: { name?: string }) => {
    const absPath = path.resolve(folder)
    if (!existsSync(absPath)) {
      console.error(`Folder not found: ${absPath}`)
      process.exit(1)
    }
    const db = getDb()
    const existing = getProjectByPath(db, absPath)
    if (existing) {
      console.error(`Project already registered: ${existing.name} (${shortId(existing.id)})`)
      process.exit(1)
    }
    const name = opts.name ?? path.basename(absPath)
    const project = createProject(db, { id: crypto.randomUUID(), name, path: absPath })
    console.log(`Added project "${project.name}"  ${shortId(project.id)}`)
    console.log(`Path: ${project.path}`)
  })

projectsCmd
  .command('list')
  .description('List all projects')
  .option('--json', 'Output as JSON')
  .action((opts: { json?: boolean }) => {
    const db = getDb()
    const projects = listProjects(db)
    if (opts.json) { console.log(JSON.stringify(projects, null, 2)); return }
    if (projects.length === 0) { console.log('No projects yet. Use: projects add <folder>'); return }
    console.log('\nProjects:')
    for (const p of projects) {
      const sessions = listSessions(db, p.id)
      console.log(`  ${shortId(p.id)}  ${p.name}  (${sessions.length} sessions)`)
      console.log(`         ${p.path}`)
    }
  })

projectsCmd
  .command('rename <id> <name>')
  .description('Rename a project')
  .action((id: string, name: string) => {
    const db = getDb()
    const project = getProject(db, id) ?? listProjects(db).find((p) => p.id.startsWith(id))
    if (!project) { console.error(`Project not found: ${id}`); process.exit(1) }
    updateProject(db, project.id, { name })
    console.log(`Renamed to "${name}"`)
  })

projectsCmd
  .command('remove <id>')
  .description('Remove a project (sessions are kept)')
  .action((id: string) => {
    const db = getDb()
    const project = getProject(db, id) ?? listProjects(db).find((p) => p.id.startsWith(id))
    if (!project) { console.error(`Project not found: ${id}`); process.exit(1) }
    deleteProject(db, project.id)
    console.log(`Removed project "${project.name}"`)
  })

// ═══════════════════════════════════════════════════════════════════════════════
// sessions
// ═══════════════════════════════════════════════════════════════════════════════

const sessionsCmd = program.command('sessions').description('Manage chat sessions')

sessionsCmd
  .command('list')
  .description('List sessions')
  .option('-p, --project <id>', 'Filter by project (prefix match)')
  .option('--json', 'Output as JSON')
  .action((opts: { project?: string; json?: boolean }) => {
    const db = getDb()

    let projectId: string | undefined
    if (opts.project) {
      const projects = listProjects(db)
      const found = projects.find(
        (p) => p.id === opts.project || p.id.startsWith(opts.project!),
      )
      if (!found) { console.error(`Project not found: ${opts.project}`); process.exit(1) }
      projectId = found.id
    }

    const sessions = listSessions(db, projectId)
    if (opts.json) { console.log(JSON.stringify(sessions, null, 2)); return }
    if (sessions.length === 0) { console.log('No sessions yet.'); return }

    const projects = listProjects(db)
    const projectMap = new Map(projects.map((p) => [p.id, p]))

    console.log('\nSessions:')
    for (const s of sessions) {
      const proj = s.project_id ? projectMap.get(s.project_id) : null
      const projLabel = proj ? `[${proj.name}] ` : ''
      const skill = s.skill_id ? ` · ${s.skill_id}` : ''
      console.log(`  ${shortId(s.id)}  ${projLabel}${s.name}`)
      console.log(`         ${s.agent_id}${skill} · ${fmtDate(s.updated_at)}`)
    }
  })

sessionsCmd
  .command('new')
  .description('Create a new session')
  .option('-p, --project <id>', 'Associate with a project (prefix match)')
  .option('-a, --agent <id>', 'Agent to use', 'opencode')
  .option('-s, --skill <id>', 'Skill to activate')
  .option('-m, --model <id>', 'Model override')
  .option('-n, --name <name>', 'Session name')
  .action(
    (opts: {
      project?: string
      agent: string
      skill?: string
      model?: string
      name?: string
    }) => {
      const db = getDb()

      let projectId: string | undefined
      if (opts.project) {
        const projects = listProjects(db)
        const found = projects.find(
          (p) => p.id === opts.project || p.id.startsWith(opts.project!),
        )
        if (!found) { console.error(`Project not found: ${opts.project}`); process.exit(1) }
        projectId = found.id
      }

      const session = createSession(db, {
        id: crypto.randomUUID(),
        projectId,
        name: opts.name ?? 'New session',
        agentId: opts.agent,
        skillId: opts.skill,
        model: opts.model,
      })
      console.log(`Created session ${shortId(session.id)}  "${session.name}"`)
      console.log(`Resume with: runner chat --session ${session.id}`)
    },
  )

sessionsCmd
  .command('show <id>')
  .description('Show session conversation history')
  .action((id: string) => {
    const db = getDb()
    const sessions = listSessions(db)
    const session = getSession(db, id) ?? sessions.find((s) => s.id.startsWith(id))
    if (!session) { console.error(`Session not found: ${id}`); process.exit(1) }

    const proj = session.project_id ? getProject(db, session.project_id) : null
    console.log(`\nSession: ${session.id}`)
    console.log(`Name   : ${session.name}`)
    if (proj) console.log(`Project: ${proj.name} (${proj.path})`)
    console.log(`Agent  : ${session.agent_id}${session.skill_id ? ` · skill: ${session.skill_id}` : ''}`)
    if (session.external_session_id)
      console.log(`Native : ${session.external_session_id}  (agent's own session ID)`)
    console.log(`Updated: ${fmtDate(session.updated_at)}`)

    const messages = getMessages(db, session.id)
    if (messages.length === 0) {
      console.log('\n(no messages yet)')
      return
    }
    console.log('')
    for (const m of messages) {
      console.log(`[${m.role.toUpperCase()}]`)
      console.log(m.content)
      console.log()
    }
  })

sessionsCmd
  .command('rename <id> <name>')
  .description('Rename a session')
  .action((id: string, name: string) => {
    const db = getDb()
    const sessions = listSessions(db)
    const session = getSession(db, id) ?? sessions.find((s) => s.id.startsWith(id))
    if (!session) { console.error(`Session not found: ${id}`); process.exit(1) }
    renameSession(db, session.id, name)
    console.log(`Renamed to "${name}"`)
  })

sessionsCmd
  .command('changes <id>')
  .description('Show file changes recorded in a session')
  .option('-r, --run <run-id>', 'Filter by a specific run')
  .option('--diff', 'Show the full diff for each changed file')
  .option('--json', 'Output as JSON')
  .action((id: string, opts: { run?: string; diff?: boolean; json?: boolean }) => {
    const db = getDb()
    const sessions = listSessions(db)
    const session = getSession(db, id) ?? sessions.find((s) => s.id.startsWith(id))
    if (!session) { console.error(`Session not found: ${id}`); process.exit(1) }

    const changes = opts.run
      ? getFileChangesForRun(db, opts.run)
      : getFileChangesForSession(db, session.id)

    if (opts.json) { console.log(JSON.stringify(changes, null, 2)); return }

    if (changes.length === 0) {
      console.log('No file changes recorded for this session.')
      return
    }

    const SYMBOL: Record<string, string> = { added: '+', modified: '~', deleted: '-' }

    // Group by run
    const byRun = new Map<string, typeof changes>()
    for (const c of changes) {
      if (!byRun.has(c.run_id)) byRun.set(c.run_id, [])
      byRun.get(c.run_id)!.push(c)
    }

    console.log(`\nFile changes in session ${shortId(session.id)}  "${session.name}":`)
    for (const [runId, runChanges] of byRun) {
      console.log(`\n  Run ${shortId(runId)}:`)
      for (const c of runChanges) {
        console.log(`    ${SYMBOL[c.change_type] ?? '?'} ${c.path}`)
        if (opts.diff && c.diff) {
          const indented = c.diff.split('\n').map((l) => '      ' + l).join('\n')
          console.log(indented)
        }
      }
    }

    const added = changes.filter((c) => c.change_type === 'added').length
    const modified = changes.filter((c) => c.change_type === 'modified').length
    const deleted = changes.filter((c) => c.change_type === 'deleted').length
    console.log(`\n  ${added} added  ${modified} modified  ${deleted} deleted`)
  })

sessionsCmd
  .command('remove <id>')
  .description('Delete a session and all its messages')
  .action((id: string) => {
    const db = getDb()
    const sessions = listSessions(db)
    const session = getSession(db, id) ?? sessions.find((s) => s.id.startsWith(id))
    if (!session) { console.error(`Session not found: ${id}`); process.exit(1) }
    deleteSession(db, session.id)
    console.log(`Deleted session "${session.name}"`)
  })

// ═══════════════════════════════════════════════════════════════════════════════
// chat  — send a message (new or existing session)
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('chat')
  .description('Send a message to an agent (creates or resumes a session)')
  .requiredOption('-m, --message <text>', 'Message to send')
  .option('--session <id>', 'Resume an existing session (prefix match)')
  .option('-p, --project <id>', 'Associate new session with a project (prefix match)')
  .option('-a, --agent <id>', 'Agent to use (default: opencode)')
  .option('-s, --skill <id>', 'Skill to activate')
  .option('--model <id>', 'Model override')
  .option('-c, --context <text>', 'Extra inline context')
  .option('-f, --context-file <path>', 'Extra context file')
  .option('--json', 'Output raw JSON events')
  .action(
    async (opts: {
      message: string
      session?: string
      project?: string
      agent?: string
      skill?: string
      model?: string
      context?: string
      contextFile?: string
      json?: boolean
    }) => {
      const db = getDb()

      // Resolve session by prefix
      let sessionId: string | undefined
      if (opts.session) {
        const sessions = listSessions(db)
        const found = getSession(db, opts.session) ?? sessions.find((s) => s.id.startsWith(opts.session!))
        if (!found) { console.error(`Session not found: ${opts.session}`); process.exit(1) }
        sessionId = found.id
      }

      // Resolve project by prefix
      let projectId: string | undefined
      if (opts.project && !sessionId) {
        const projects = listProjects(db)
        const found = projects.find(
          (p) => p.id === opts.project || p.id.startsWith(opts.project!),
        )
        if (!found) { console.error(`Project not found: ${opts.project}`); process.exit(1) }
        projectId = found.id
      }

      try {
        const result = await sendMessage({
          sessionId,
          newSession: sessionId
            ? undefined
            : { projectId, agentId: opts.agent, skillId: opts.skill, model: opts.model },
          message: opts.message,
          context: opts.context,
          contextFile: opts.contextFile,
          onEvent: (event) => {
            if (opts.json) { console.log(JSON.stringify(event)); return }
            printEvent(event)
          },
        })

        if (!opts.json) {
          console.error(`\nSession: ${result.sessionId}`)
          console.error(`Run    : ${result.runId}`)
          console.error(`Resume : runner chat --session ${result.sessionId} --message "..."`)
        }
        process.exit(result.exitCode)
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    },
  )

// ═══════════════════════════════════════════════════════════════════════════════
// agents / skills (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

program
  .command('agents')
  .description('List detected agents')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const agents = await detectAgents()
    if (opts.json) { console.log(JSON.stringify(agents, null, 2)); return }
    console.log('\nDetected agents:')
    for (const a of agents) {
      const mark = a.available ? '✓' : '✗'
      const ver = a.version ? ` v${a.version}` : ''
      const models = a.available ? ` (${a.models.length} models, ${a.modelsSource})` : ''
      console.log(`  ${mark} ${a.name}${ver}${models}`)
      if (!a.available) {
        const def = getAgentDef(a.id)
        if (def?.installUrl) console.log(`    Install: ${def.installUrl}`)
      }
    }
  })

const skillsCmd = program.command('skills').description('Manage skills')

skillsCmd
  .command('list')
  .description('List available skills')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const skills = await loadSkills(SKILLS_ROOTS)
    if (opts.json) {
      console.log(JSON.stringify(skills.map(({ id, name, description, tags, source }) => ({ id, name, description, tags, source })), null, 2))
      return
    }
    if (skills.length === 0) { console.log('No skills found. Add skill folders to ./skills/'); return }
    console.log('\nAvailable skills:')
    for (const s of skills) {
      const tags = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : ''
      console.log(`  ${s.id}${tags}`)
      if (s.description) console.log(`    ${s.description}`)
    }
  })

skillsCmd
  .command('show <id>')
  .description('Show skill body')
  .action(async (id: string) => {
    const skills = await loadSkills(SKILLS_ROOTS)
    const skill = skills.find((s) => s.id === id)
    if (!skill) { console.error(`Skill "${id}" not found.`); process.exit(1) }
    console.log(`\n── ${skill.name} ──`)
    console.log(`Source : ${skill.source}`)
    console.log(`Tags   : ${skill.tags.join(', ') || '—'}`)
    if (skill.description) console.log(`Desc   : ${skill.description}`)
    const sideKeys = Object.keys(skill.sideFiles)
    if (sideKeys.length > 0) console.log(`Files  : ${sideKeys.join(', ')}`)
    console.log('\n' + skill.body)
  })

program.parseAsync(process.argv)
