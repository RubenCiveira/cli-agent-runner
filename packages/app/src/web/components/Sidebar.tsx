import type { Project, Session } from '../api.ts'
import type { AppView } from '../App.tsx'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Icons ─────────────────────────────────────────────────────────────────────

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

function LibraryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2.5 0h2A1.5 1.5 0 0 1 6 1.5v13A1.5 1.5 0 0 1 4.5 16h-2A1.5 1.5 0 0 1 1 14.5v-13A1.5 1.5 0 0 1 2.5 0Zm0 1.5v13h2v-13Zm5 0h2A1.5 1.5 0 0 1 11 3v10a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 6 13V3a1.5 1.5 0 0 1 1.5-1.5Zm0 1.5V13h2V3Zm5.25-.5a.75.75 0 0 1 .71.504l2 6a.75.75 0 0 1-.71.996H13.5v4.25a.75.75 0 0 1-1.5 0V10H10.5v-.246l.002-.004 2-6a.75.75 0 0 1 .248-.25Z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.364-1.891l.814-.806c.049-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.814-.806C.83 6.585.626 5.838.941 5.163a7.86 7.86 0 0 1 .704-1.218c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM8 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </svg>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  projects: Project[]
  sessions: Session[]
  selectedProject: Project | null
  selectedSession: Session | null
  view: AppView
  onSelectProject: (p: Project) => void
  onSelectSession: (s: Session) => void
  onAddProject: () => void
  onNewSession: () => void
  onViewChange: (v: AppView) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({
  projects, sessions, selectedProject, selectedSession, view,
  onSelectProject, onSelectSession, onAddProject, onNewSession, onViewChange,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>opencode runner</h1>
      </div>

      {/* Projects */}
      <div className="sidebar-section" style={{ maxHeight: '40%' }}>
        <div className="section-header">
          <span>Projects</span>
          <button className="btn-icon" onClick={onAddProject} title="Add project"><PlusIcon /></button>
        </div>
        <div className="section-list">
          {projects.length === 0 && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>No projects yet</div>
          )}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`sidebar-item ${selectedProject?.id === p.id && view === 'chat' ? 'active' : ''}`}
              onClick={() => onSelectProject(p)}
            >
              <div className="item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FolderIcon active={selectedProject?.id === p.id && view === 'chat'} />
                {p.name}
              </div>
              <div className="item-meta">
                <span>{p.sessionCount ?? 0} sessions</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sessions */}
      <div className="sidebar-section grow">
        <div className="section-header">
          <span>{selectedProject ? `Sessions — ${selectedProject.name}` : 'Sessions'}</span>
          {selectedProject && (
            <button className="btn-icon" onClick={onNewSession} title="New session"><PlusIcon /></button>
          )}
        </div>
        <div className="section-list">
          {!selectedProject && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>Select a project</div>
          )}
          {selectedProject && sessions.length === 0 && (
            <div style={{ padding: '8px 14px', color: 'var(--text-dim)', fontSize: 11 }}>No sessions yet</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`sidebar-item ${selectedSession?.id === s.id && view === 'chat' ? 'active' : ''}`}
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

      {/* Bottom nav */}
      <div className="sidebar-footer">
        {selectedProject && (
          <button
            className={`sidebar-nav-btn${view === 'project-resources' ? ' active' : ''}`}
            onClick={() => onViewChange(view === 'project-resources' ? 'chat' : 'project-resources')}
            title="Project resources"
          >
            <SettingsIcon />
            <span>Project resources</span>
          </button>
        )}
        <button
          className={`sidebar-nav-btn${view === 'library' ? ' active' : ''}`}
          onClick={() => onViewChange(view === 'library' ? 'chat' : 'library')}
          title="Resource library"
        >
          <LibraryIcon />
          <span>Library</span>
        </button>
      </div>
    </aside>
  )
}
