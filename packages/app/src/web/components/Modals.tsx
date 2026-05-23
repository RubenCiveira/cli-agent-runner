import { useState, useEffect, useRef } from 'react'
import type { Skill, Agent } from '../api.ts'

// ── Add Project ───────────────────────────────────────────────────────────────

interface AddProjectProps {
  onAdd: (path: string, name?: string) => Promise<void>
  onClose: () => void
}

export function AddProjectModal({ onAdd, onClose }: AddProjectProps) {
  const [folderPath, setFolderPath] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!folderPath.trim()) return
    setLoading(true); setError('')
    try {
      await onAdd(folderPath.trim(), name.trim() || undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error adding project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>Add project</h2>
        <div className="field">
          <label>Folder path</label>
          <input ref={inputRef} value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/path/to/project" />
        </div>
        <div className="field">
          <label>Display name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" />
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!folderPath.trim() || loading}>
            {loading ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── New Session ───────────────────────────────────────────────────────────────

interface NewSessionProps {
  projectId: string
  skills: Skill[]
  agents: Agent[]
  onCreate: (opts: { name?: string; agentId?: string; skillId?: string; model?: string }) => Promise<void>
  onClose: () => void
}

export function NewSessionModal({ projectId: _projectId, skills, agents, onCreate, onClose }: NewSessionProps) {
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState(() => agents.find((a) => a.available)?.id ?? 'opencode')
  const [skillId, setSkillId] = useState('')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableAgents = agents.filter((a) => a.available)
  const selectedAgent = agents.find((a) => a.id === agentId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await onCreate({
        name: name.trim() || undefined,
        agentId,
        skillId: skillId || undefined,
        model: model || undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2>New session</h2>

        <div className="field">
          <label>Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-named from first message" />
        </div>

        <div className="field">
          <label>Agent</label>
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setModel('') }}>
            {availableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.version ? ` ${a.version}` : ''}</option>)}
            {availableAgents.length === 0 && <option value="opencode">opencode (not detected)</option>}
          </select>
        </div>

        {selectedAgent && selectedAgent.models.length > 1 && (
          <div className="field">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Default</option>
              {selectedAgent.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}

        <div className="field">
          <label>Skill</label>
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">None</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ''}</option>)}
          </select>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 12 }}>{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating…' : 'Create session'}
          </button>
        </div>
      </form>
    </div>
  )
}
