import type { Project, Session } from '../api.ts'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Icons (inline SVG, no dep) ────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
    </svg>
  )
}

function FolderIcon({ active }: { active?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={active ? 'var(--accent)' : 'var(--text-muted)'}>
      <path d="M1.75 3a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75v-6.5a.75.75 0 0 0-.75-.75H7.81L6.56 3.53A.75.75 0 0 0 6 3H1.75Z" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.457 1.457 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  projects: Project[]
  sessions: Session[]
  selectedProject: Project | null
  selectedSession: Session | null
  onSelectProject: (p: Project) => void
  onSelectSession: (s: Session) => void
  onAddProject: () => void
  onNewSession: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({
  projects,
  sessions,
  selectedProject,
  selectedSession,
  onSelectProject,
  onSelectSession,
  onAddProject,
  onNewSession,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* App title */}
      <div className="sidebar-header">
        <h1>opencode runner</h1>
      </div>

      {/* Projects section */}
      <div className="sidebar-section" style={{ maxHeight: '40%' }}>
        <div className="section-header">
          <span>Projects</span>
          <button className="btn-icon" onClick={onAddProject} title="Add project"><PlusIcon /></button>
        </div>
        <div className="section-list">
          {projects.length === 0 && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>
              No projects yet
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`sidebar-item ${selectedProject?.id === p.id ? 'active' : ''}`}
              onClick={() => onSelectProject(p)}
            >
              <div className="item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FolderIcon active={selectedProject?.id === p.id} />
                {p.name}
              </div>
              <div className="item-meta">
                <span>{p.sessionCount ?? 0} sessions</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sessions section — only when a project is selected */}
      <div className="sidebar-section grow">
        <div className="section-header">
          <span>
            {selectedProject ? `Sessions — ${selectedProject.name}` : 'Sessions'}
          </span>
          {selectedProject && (
            <button className="btn-icon" onClick={onNewSession} title="New session"><PlusIcon /></button>
          )}
        </div>
        <div className="section-list">
          {!selectedProject && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>
              Select a project
            </div>
          )}
          {selectedProject && sessions.length === 0 && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>
              No sessions yet
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`sidebar-item ${selectedSession?.id === s.id ? 'active' : ''}`}
              onClick={() => onSelectSession(s)}
            >
              <div className="item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChatIcon />
                {s.name}
              </div>
              <div className="item-meta">
                {s.skill_id && <span className="tag">{s.skill_id}</span>}
                <span>{relativeTime(s.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
