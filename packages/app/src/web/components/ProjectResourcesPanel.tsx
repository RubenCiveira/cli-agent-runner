import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.ts'
import type { Project, AgentRecord, SkillRecord, McpServerRecord, ContextFileRecord } from '../api.ts'

type Tab = 'agents' | 'skills' | 'mcps' | 'contexts'

function Tabs({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'agents', label: 'Agents' },
    { id: 'skills', label: 'Skills' },
    { id: 'mcps', label: 'MCP servers' },
    { id: 'contexts', label: 'Context files' },
  ]
  return (
    <div className="lib-tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`lib-tab${active === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Agents assignment ─────────────────────────────────────────────────────────

function AssignAgents({ projectId }: { projectId: string }) {
  const [all, setAll] = useState<AgentRecord[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [allAgents, res] = await Promise.all([
      api.resources.agents.list(),
      api.projectResources.get(projectId),
    ])
    setAll(allAgents)
    setAssigned(new Set(res.agents.map((a) => a.id)))
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function toggle(id: string) {
    setSaving(true)
    const next = new Set(assigned)
    if (next.has(id)) next.delete(id); else next.add(id)
    await api.projectResources.setAgents(projectId, [...next])
    setAssigned(next)
    setSaving(false)
  }

  if (all.length === 0) return <div className="lib-empty">No agents in library yet. Add some in the Library.</div>

  return (
    <div className="assign-list">
      {all.map((a) => (
        <label key={a.id} className="assign-item">
          <input type="checkbox" checked={assigned.has(a.id)} onChange={() => !saving && toggle(a.id)} />
          <div className="assign-info">
            <span className="assign-name">{a.name}</span>
            <span className="assign-meta">{a.content.slice(0, 100).replace(/\n/g, ' ')}…</span>
          </div>
        </label>
      ))}
    </div>
  )
}

// ── Skills assignment ─────────────────────────────────────────────────────────

function AssignSkills({ projectId }: { projectId: string }) {
  const [all, setAll] = useState<SkillRecord[]>([])
  const [assigned, setAssigned] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [allSkills, res] = await Promise.all([
      api.resources.skills.list(),
      api.projectResources.get(projectId),
    ])
    setAll(allSkills)
    setAssigned(new Set(res.skills.map((s) => s.id)))
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function toggle(id: string) {
    setSaving(true)
    const next = new Set(assigned)
    if (next.has(id)) next.delete(id); else next.add(id)
    await api.projectResources.setSkills(projectId, [...next])
    setAssigned(next)
    setSaving(false)
  }

  if (all.length === 0) return <div className="lib-empty">No skills in library yet. Add some in the Library.</div>

  return (
    <div className="assign-list">
      {all.map((s) => (
        <label key={s.id} className="assign-item">
          <input type="checkbox" checked={assigned.has(s.id)} onChange={() => !saving && toggle(s.id)} />
          <div className="assign-info">
            <span className="assign-name">{s.name}</span>
            <span className="assign-meta">{s.content.slice(0, 100).replace(/\n/g, ' ')}…</span>
          </div>
        </label>
      ))}
    </div>
  )
}

// ── MCPs assignment ───────────────────────────────────────────────────────────

interface McpAssignState {
  enabled: boolean
  envOverride: Record<string, string>
  expanded: boolean
}

function AssignMcps({ projectId }: { projectId: string }) {
  const [all, setAll] = useState<McpServerRecord[]>([])
  const [state, setState] = useState<Record<string, McpAssignState>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [allMcps, res] = await Promise.all([
      api.resources.mcps.list(),
      api.projectResources.get(projectId),
    ])
    setAll(allMcps)
    const s: Record<string, McpAssignState> = {}
    for (const m of allMcps) {
      const assigned = res.mcps.find((pm) => pm.id === m.id)
      s[m.id] = { enabled: !!assigned, envOverride: assigned?.env ?? {}, expanded: false }
    }
    setState(s)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function toggleEnabled(id: string) {
    const cur = state[id]
    if (!cur) return
    setSaving(id)
    if (cur.enabled) {
      await api.projectResources.removeMcp(projectId, id)
      setState((s) => ({ ...s, [id]: { ...s[id], enabled: false } }))
    } else {
      await api.projectResources.setMcp(projectId, id, Object.keys(cur.envOverride).length > 0 ? cur.envOverride : undefined)
      setState((s) => ({ ...s, [id]: { ...s[id], enabled: true } }))
    }
    setSaving(null)
  }

  async function saveEnv(id: string, envOverride: Record<string, string>) {
    setSaving(id)
    await api.projectResources.setMcp(projectId, id, Object.keys(envOverride).length > 0 ? envOverride : undefined)
    setState((s) => ({ ...s, [id]: { ...s[id], envOverride } }))
    setSaving(null)
  }

  if (all.length === 0) return <div className="lib-empty">No MCP servers in library yet. Add some in the Library.</div>

  return (
    <div className="assign-list">
      {all.map((m) => {
        const s = state[m.id]
        if (!s) return null
        return (
          <div key={m.id} className="assign-mcp-item">
            <div className="assign-mcp-row">
              <label className="assign-item" style={{ flex: 1 }}>
                <input type="checkbox" checked={s.enabled} onChange={() => saving !== m.id && toggleEnabled(m.id)} />
                <div className="assign-info">
                  <span className="assign-name">{m.name}</span>
                  <span className="assign-meta" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{m.command.join(' ')}</span>
                </div>
              </label>
              {s.enabled && (
                <button
                  className="btn-icon"
                  title="Configure credentials"
                  onClick={() => setState((prev) => ({ ...prev, [m.id]: { ...prev[m.id], expanded: !prev[m.id].expanded } }))}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
                    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                  </svg>
                </button>
              )}
            </div>
            {s.enabled && s.expanded && (
              <EnvOverrideEditor
                baseEnv={m.env ?? {}}
                value={s.envOverride}
                onSave={(env) => saveEnv(m.id, env)}
                saving={saving === m.id}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function EnvOverrideEditor({
  baseEnv,
  value,
  onSave,
  saving,
}: {
  baseEnv: Record<string, string>
  value: Record<string, string>
  onSave: (env: Record<string, string>) => void
  saving: boolean
}) {
  const [pairs, setPairs] = useState<{ k: string; v: string }[]>(() => {
    const keys = new Set([...Object.keys(baseEnv), ...Object.keys(value)])
    const out = [...keys].map((k) => ({ k, v: value[k] ?? '' }))
    return out.length > 0 ? [...out, { k: '', v: '' }] : [{ k: '', v: '' }]
  })

  function setRow(i: number, field: 'k' | 'v', val: string) {
    setPairs((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      if (i === prev.length - 1 && (next[i].k || next[i].v)) next.push({ k: '', v: '' })
      return next
    })
  }

  function save() {
    const env: Record<string, string> = {}
    for (const { k, v } of pairs) {
      if (k.trim()) env[k.trim()] = v
    }
    onSave(env)
  }

  return (
    <div className="env-editor">
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Project credentials (override defaults)</div>
      {pairs.map((pair, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            value={pair.k}
            onChange={(e) => setRow(i, 'k', e.target.value)}
            placeholder="KEY"
            className="env-input"
          />
          <input
            value={pair.v}
            onChange={(e) => setRow(i, 'v', e.target.value)}
            placeholder="value"
            type={pair.k.toLowerCase().includes('token') || pair.k.toLowerCase().includes('secret') || pair.k.toLowerCase().includes('key') ? 'password' : 'text'}
            className="env-input env-input-val"
          />
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save credentials'}
      </button>
    </div>
  )
}

// ── Context files assignment ──────────────────────────────────────────────────

function AssignContexts({ projectId }: { projectId: string }) {
  const [all, setAll] = useState<ContextFileRecord[]>([])
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [allCtx, res] = await Promise.all([
      api.resources.contexts.list(),
      api.projectResources.get(projectId),
    ])
    setAll(allCtx)
    setAssignedIds(new Set(res.contexts.map((c) => c.id)))
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function toggle(file: ContextFileRecord) {
    setSaving(true)
    if (assignedIds.has(file.id)) {
      await api.projectResources.unassignContext(projectId, file.id)
      setAssignedIds((s) => { const n = new Set(s); n.delete(file.id); return n })
    } else {
      // server enforces one-per-type
      const updated = await api.projectResources.assignContext(projectId, file.id)
      setAssignedIds(new Set(updated.map((c) => c.id)))
    }
    setSaving(false)
  }

  if (all.length === 0) return <div className="lib-empty">No context files in library yet. Add some in the Library.</div>

  // Group by type
  const typed = new Map<string, ContextFileRecord[]>()
  const untyped: ContextFileRecord[] = []
  for (const f of all) {
    if (f.type) {
      const g = typed.get(f.type) ?? []
      g.push(f)
      typed.set(f.type, g)
    } else {
      untyped.push(f)
    }
  }

  return (
    <div className="assign-list">
      {[...typed.entries()].map(([type, files]) => (
        <div key={type} className="assign-ctx-group">
          <div className="assign-ctx-type">
            <span className="tag">{type}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>— only one can be active</span>
          </div>
          {files.map((f) => (
            <label key={f.id} className="assign-item">
              <input
                type="radio"
                name={`ctx-type-${type}-${projectId}`}
                checked={assignedIds.has(f.id)}
                onChange={() => !saving && !assignedIds.has(f.id) && toggle(f)}
              />
              <div className="assign-info">
                <span className="assign-name">{f.name}</span>
                <span className="assign-meta">{f.content.slice(0, 80).replace(/\n/g, ' ')}…</span>
              </div>
            </label>
          ))}
        </div>
      ))}
      {untyped.length > 0 && (
        <div className="assign-ctx-group">
          {typed.size > 0 && <div className="assign-ctx-type"><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Untyped (multiple allowed)</span></div>}
          {untyped.map((f) => (
            <label key={f.id} className="assign-item">
              <input type="checkbox" checked={assignedIds.has(f.id)} onChange={() => !saving && toggle(f)} />
              <div className="assign-info">
                <span className="assign-name">{f.name}</span>
                <span className="assign-meta">{f.content.slice(0, 80).replace(/\n/g, ' ')}…</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface ProjectResourcesPanelProps {
  project: Project
}

export function ProjectResourcesPanel({ project }: ProjectResourcesPanelProps) {
  const [tab, setTab] = useState<Tab>('agents')

  return (
    <div className="lib-panel">
      <div className="lib-header">
        <h2>{project.name} — Resources</h2>
        <p>Select which agents, skills, MCP servers and context files are injected into every session of this project.</p>
      </div>
      <Tabs active={tab} onChange={setTab} />
      <div className="lib-tab-body">
        {tab === 'agents' && <AssignAgents projectId={project.id} />}
        {tab === 'skills' && <AssignSkills projectId={project.id} />}
        {tab === 'mcps' && <AssignMcps projectId={project.id} />}
        {tab === 'contexts' && <AssignContexts projectId={project.id} />}
      </div>
    </div>
  )
}
