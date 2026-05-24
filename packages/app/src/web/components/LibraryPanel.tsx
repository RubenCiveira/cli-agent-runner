import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.ts'
import type { AgentRecord, SkillRecord, McpServerRecord, ContextFileRecord } from '../api.ts'

// ── Shared helpers ────────────────────────────────────────────────────────────

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

function EmptyRow({ label }: { label: string }) {
  return <div className="lib-empty">{label}</div>
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-icon btn-icon-danger" onClick={onClick} title="Delete">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
      </svg>
    </button>
  )
}

function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-icon" onClick={onClick} title="Edit">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z" />
      </svg>
    </button>
  )
}

// ── Content editor modal ──────────────────────────────────────────────────────

interface ContentModalProps {
  title: string
  initialName?: string
  initialContent?: string
  initialType?: string
  showType?: boolean
  onSave: (name: string, content: string, type?: string) => Promise<void>
  onClose: () => void
}

function ContentModal({ title, initialName = '', initialContent = '', initialType = '', showType, onSave, onClose }: ContentModalProps) {
  const [name, setName] = useState(initialName)
  const [content, setContent] = useState(initialContent)
  const [type, setType] = useState(initialType)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return
    setLoading(true); setError('')
    try {
      await onSave(name.trim(), content.trim(), showType ? (type.trim() || undefined) : undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit}>
        <h2>{title}</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-agent" autoFocus />
        </div>
        {showType && (
          <div className="field">
            <label>Type <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — one per type per project)</span></label>
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Design" />
          </div>
        )}
        <div className="field">
          <label>Content (markdown)</label>
          <textarea className="lib-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write agent instructions..." />
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !content.trim() || loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── MCP editor modal ──────────────────────────────────────────────────────────

interface McpModalProps {
  initial?: McpServerRecord
  onSave: (data: { id?: string; name: string; command: string[]; env?: Record<string, string> }) => Promise<void>
  onClose: () => void
}

function McpModal({ initial, onSave, onClose }: McpModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command.join(' ') ?? '')
  const [envPairs, setEnvPairs] = useState<{ k: string; v: string }[]>(() => {
    const e = initial?.env
    if (!e) return [{ k: '', v: '' }]
    return [...Object.entries(e).map(([k, v]) => ({ k, v })), { k: '', v: '' }]
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function setEnv(i: number, field: 'k' | 'v', val: string) {
    setEnvPairs((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: val }
      // auto-add empty row at end
      if (i === prev.length - 1 && (next[i].k || next[i].v)) next.push({ k: '', v: '' })
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parts = command.trim().split(/\s+/).filter(Boolean)
    if (!name.trim() || parts.length === 0) return
    const env: Record<string, string> = {}
    for (const { k, v } of envPairs) {
      if (k.trim()) env[k.trim()] = v
    }
    setLoading(true); setError('')
    try {
      await onSave({ id: initial?.id, name: name.trim(), command: parts, env: Object.keys(env).length > 0 ? env : undefined })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit}>
        <h2>{initial ? 'Edit MCP server' : 'Add MCP server'}</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" autoFocus />
        </div>
        <div className="field">
          <label>Command <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(space-separated)</span></label>
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-github" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
        </div>
        <div className="field">
          <label>Environment variables <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(defaults, non-secret)</span></label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {envPairs.map((pair, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input value={pair.k} onChange={(e) => setEnv(i, 'k', e.target.value)} placeholder="KEY" style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12 }} />
                <input value={pair.v} onChange={(e) => setEnv(i, 'v', e.target.value)} placeholder="value" style={{ flex: 2, fontFamily: 'var(--mono)', fontSize: 12 }} />
              </div>
            ))}
          </div>
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !command.trim() || loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab() {
  const [items, setItems] = useState<AgentRecord[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; item: AgentRecord } | null>(null)

  const load = useCallback(() => api.resources.agents.list().then(setItems), [])
  useEffect(() => { load() }, [load])

  async function save(name: string, content: string) {
    if (modal?.mode === 'edit') await api.resources.agents.update(modal.item.id, { name, content })
    else await api.resources.agents.create({ name, content })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this agent?')) return
    await api.resources.agents.remove(id)
    load()
  }

  return (
    <div className="lib-tab-body">
      <div className="lib-toolbar">
        <span className="lib-count">{items.length} agent{items.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add' })}>Add agent</button>
      </div>
      {items.length === 0 ? <EmptyRow label="No agents yet" /> : (
        <div className="lib-list">
          {items.map((a) => (
            <div key={a.id} className="lib-item">
              <div className="lib-item-name">{a.name}</div>
              <div className="lib-item-meta">{a.content.slice(0, 80).replace(/\n/g, ' ')}…</div>
              <div className="lib-item-actions">
                <EditBtn onClick={() => setModal({ mode: 'edit', item: a })} />
                <DeleteBtn onClick={() => remove(a.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <ContentModal
          title={modal.mode === 'edit' ? 'Edit agent' : 'Add agent'}
          initialName={modal.mode === 'edit' ? modal.item.name : ''}
          initialContent={modal.mode === 'edit' ? modal.item.content : ''}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Skills tab ────────────────────────────────────────────────────────────────

function SkillsTab() {
  const [items, setItems] = useState<SkillRecord[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; item: SkillRecord } | null>(null)

  const load = useCallback(() => api.resources.skills.list().then(setItems), [])
  useEffect(() => { load() }, [load])

  async function save(name: string, content: string) {
    if (modal?.mode === 'edit') await api.resources.skills.update(modal.item.id, { name, content })
    else await api.resources.skills.create({ name, content })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this skill?')) return
    await api.resources.skills.remove(id)
    load()
  }

  return (
    <div className="lib-tab-body">
      <div className="lib-toolbar">
        <span className="lib-count">{items.length} skill{items.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add' })}>Add skill</button>
      </div>
      {items.length === 0 ? <EmptyRow label="No skills yet" /> : (
        <div className="lib-list">
          {items.map((s) => (
            <div key={s.id} className="lib-item">
              <div className="lib-item-name">{s.name}</div>
              <div className="lib-item-meta">{s.content.slice(0, 80).replace(/\n/g, ' ')}…</div>
              <div className="lib-item-actions">
                <EditBtn onClick={() => setModal({ mode: 'edit', item: s })} />
                <DeleteBtn onClick={() => remove(s.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <ContentModal
          title={modal.mode === 'edit' ? 'Edit skill' : 'Add skill'}
          initialName={modal.mode === 'edit' ? modal.item.name : ''}
          initialContent={modal.mode === 'edit' ? modal.item.content : ''}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── MCPs tab ──────────────────────────────────────────────────────────────────

function McpsTab() {
  const [items, setItems] = useState<McpServerRecord[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; item: McpServerRecord } | null>(null)

  const load = useCallback(() => api.resources.mcps.list().then(setItems), [])
  useEffect(() => { load() }, [load])

  async function save(data: { id?: string; name: string; command: string[]; env?: Record<string, string> }) {
    if (modal?.mode === 'edit') await api.resources.mcps.update(modal.item.id, { name: data.name, command: data.command, env: data.env })
    else await api.resources.mcps.create(data)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this MCP server?')) return
    await api.resources.mcps.remove(id)
    load()
  }

  return (
    <div className="lib-tab-body">
      <div className="lib-toolbar">
        <span className="lib-count">{items.length} server{items.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add' })}>Add MCP server</button>
      </div>
      {items.length === 0 ? <EmptyRow label="No MCP servers yet" /> : (
        <div className="lib-list">
          {items.map((m) => (
            <div key={m.id} className="lib-item">
              <div className="lib-item-name">{m.name}</div>
              <div className="lib-item-meta" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{m.command.join(' ')}</div>
              <div className="lib-item-actions">
                <EditBtn onClick={() => setModal({ mode: 'edit', item: m })} />
                <DeleteBtn onClick={() => remove(m.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <McpModal
          initial={modal.mode === 'edit' ? modal.item : undefined}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Contexts tab ──────────────────────────────────────────────────────────────

function ContextsTab() {
  const [items, setItems] = useState<ContextFileRecord[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; item: ContextFileRecord } | null>(null)

  const load = useCallback(() => api.resources.contexts.list().then(setItems), [])
  useEffect(() => { load() }, [load])

  async function save(name: string, content: string, type?: string) {
    if (modal?.mode === 'edit') await api.resources.contexts.update(modal.item.id, { name, content, type })
    else await api.resources.contexts.create({ name, content, type })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this context file?')) return
    await api.resources.contexts.remove(id)
    load()
  }

  return (
    <div className="lib-tab-body">
      <div className="lib-toolbar">
        <span className="lib-count">{items.length} file{items.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ mode: 'add' })}>Add context file</button>
      </div>
      {items.length === 0 ? <EmptyRow label="No context files yet" /> : (
        <div className="lib-list">
          {items.map((f) => (
            <div key={f.id} className="lib-item">
              <div className="lib-item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.name}
                {f.type && <span className="tag">{f.type}</span>}
              </div>
              <div className="lib-item-meta">{f.content.slice(0, 80).replace(/\n/g, ' ')}…</div>
              <div className="lib-item-actions">
                <EditBtn onClick={() => setModal({ mode: 'edit', item: f })} />
                <DeleteBtn onClick={() => remove(f.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <ContentModal
          title={modal.mode === 'edit' ? 'Edit context file' : 'Add context file'}
          initialName={modal.mode === 'edit' ? modal.item.name : ''}
          initialContent={modal.mode === 'edit' ? modal.item.content : ''}
          initialType={modal.mode === 'edit' ? (modal.item.type ?? '') : ''}
          showType
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function LibraryPanel() {
  const [tab, setTab] = useState<Tab>('agents')

  return (
    <div className="lib-panel">
      <div className="lib-header">
        <h2>Resource library</h2>
        <p>Agents, skills, MCP servers and context files available to assign to projects.</p>
      </div>
      <Tabs active={tab} onChange={setTab} />
      {tab === 'agents' && <AgentsTab />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'mcps' && <McpsTab />}
      {tab === 'contexts' && <ContextsTab />}
    </div>
  )
}
